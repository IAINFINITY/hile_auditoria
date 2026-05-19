import { createChatwootClient } from "./chatwootClient";
import { createDifyClient } from "./difyClient";
import { attachDay, normalizeConversationLog, renderLogForPrompt } from "./chatMapper";
import {
  getCachedAnalysisByFingerprint,
  getConversationDeltaStates,
  getLatestConversationAnalysis,
  upsertConversationDeltaStates,
} from "./auditPersistence";
import { assertYmd, nowUnixSeconds, toYmdInTimezone, unique } from "./dateUtils";
import {
  buildContactLogs,
  buildSourceFingerprint,
  compactAnalysis,
  extractActiveOnDay,
  extractEnteredToday,
  extractNameFromFormMessages,
  getContactKey,
  mergeContactDisplayName,
  normalizeIdentifierKey,
} from "./service/contactHelpers";
import {
  buildConversationInsights,
  deriveConversationOperationalState,
} from "./service/operationalHelpers";
import {
  buildGapSection,
  buildItemSection,
  extractGapEntriesFromAnalysis,
  toArray,
  toChatwootAppBase,
  tryParseJson,
} from "./service/reportHelpers";
import {
  buildDeltaHash,
  evaluateDeltaRelevance,
  filterNewMessages,
  getLastMessageId,
} from "./service/incrementalHelpers";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeNameToken(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function resolveResponsibleBucket(senderName) {
  const normalized = normalizeNameToken(senderName);
  if (!normalized) return "ia";
  if (/\b(grupo|group|equipe|team)\b/.test(normalized)) return null;
  if (/\bsamuel\b/.test(normalized)) return "samuel";
  if (/\bsuelen\b|\bsuellen\b/.test(normalized)) return "suellen";
  if (
    /\bacesso infinity\b|\bacesso_infinity\b|\bassistant\b|\bbot\b|(^|\s)ia(\s|$)/.test(normalized)
  ) {
    return "ia";
  }
  return "ia";
}

function responsibleLabel(bucket) {
  if (bucket === "samuel") return "Comercial Samuel";
  if (bucket === "suellen") return "Comercial Suellen";
  return "IA";
}

function buildResponsibleTracking(messages) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const counts = { ia: 0, suellen: 0, samuel: 0 };
  const latestByBucket = { ia: 0, suellen: 0, samuel: 0 };
  const responseAgg = {
    ia: { sum: 0, count: 0, max: 0 },
    suellen: { sum: 0, count: 0, max: 0 },
    samuel: { sum: 0, count: 0, max: 0 },
  };

  for (const message of safeMessages) {
    const role = String(message?.role || "").toUpperCase();
    if (role !== "AGENT") continue;
    const bucket = resolveResponsibleBucket(message?.sender_name);
    if (!bucket) continue;
    counts[bucket] += 1;
    latestByBucket[bucket] = Math.max(latestByBucket[bucket] || 0, Number(message?.created_at || 0));
  }

  for (let index = 0; index < safeMessages.length; index += 1) {
    const current = safeMessages[index];
    const role = String(current?.role || "").toUpperCase();
    if (role !== "USER") continue;
    const startedAt = Number(current?.created_at || 0);
    if (!startedAt) continue;
    for (let scan = index + 1; scan < safeMessages.length; scan += 1) {
      const next = safeMessages[scan];
      const nextRole = String(next?.role || "").toUpperCase();
      if (nextRole !== "AGENT") continue;
      const bucket = resolveResponsibleBucket(next?.sender_name);
      if (!bucket) break;
      const endedAt = Number(next?.created_at || 0);
      const delta = endedAt - startedAt;
      if (delta > 0) {
        responseAgg[bucket].sum += delta;
        responseAgg[bucket].count += 1;
        responseAgg[bucket].max = Math.max(responseAgg[bucket].max, delta);
      }
      break;
    }
  }

  const ranked = ["ia", "suellen", "samuel"].sort((a, b) => {
    const byCount = Number(counts[b] || 0) - Number(counts[a] || 0);
    if (byCount !== 0) return byCount;
    return Number(latestByBucket[b] || 0) - Number(latestByBucket[a] || 0);
  });
  const ownerBucket = ranked[0] || "ia";

  const toMetric = (bucket) => ({
    avg_response_sec:
      responseAgg[bucket].count > 0
        ? Number((responseAgg[bucket].sum / responseAgg[bucket].count).toFixed(2))
        : null,
    max_response_sec: responseAgg[bucket].count > 0 ? responseAgg[bucket].max : null,
    samples: responseAgg[bucket].count,
  });

  return {
    owner_bucket: ownerBucket,
    owner_label: responsibleLabel(ownerBucket),
    message_count_agent: counts.ia + counts.suellen + counts.samuel,
    message_breakdown: counts,
    response_metrics: {
      ia: toMetric("ia"),
      suellen: toMetric("suellen"),
      samuel: toMetric("samuel"),
    },
  };
}

function looksLikeWhatsapp(inbox) {
  const provider = normalizeText(inbox?.provider);
  const channelType = normalizeText(inbox?.channel_type);
  return provider.includes("whatsapp") || channelType.includes("whatsapp");
}

function extractDifyAnswer(raw: any): string | null {
  if (!raw) return null;
  const outputs = raw?.data?.outputs || null;
  const candidate =
    raw?.answer ??
    outputs?.text ??
    outputs?.output ??
    outputs?.analysis_output ??
    outputs?.response ??
    null;
  const text = String(candidate || "").trim();
  return text || null;
}

function pickAccount(accounts, configuredAccountId, groupName) {
  if (configuredAccountId) {
    const byId = accounts.find((item) => Number(item?.id) === Number(configuredAccountId));
    if (!byId) {
      throw new Error(`CHATWOOT_ACCOUNT_ID=${configuredAccountId} não foi encontrado no profile.`);
    }
    return byId;
  }

  const exact = accounts.find((item) => normalizeText(item?.name) === normalizeText(groupName));
  if (exact) return exact;

  const partial = accounts.find((item) => normalizeText(item?.name).includes(normalizeText(groupName)));
  if (partial) return partial;

  const available = accounts.map((item) => item?.name).filter(Boolean).join(", ");
  throw new Error(`Grupo '${groupName}' não encontrado. Contas visíveis: ${available || "(nenhuma)"}`);
}

function pickInbox(inboxes, inboxName, inboxId, inboxProvider) {
  if (inboxId) {
    const byId = inboxes.find((item) => Number(item?.id) === Number(inboxId));
    if (!byId) {
      throw new Error(`CHATWOOT_INBOX_ID=${inboxId} não foi encontrado na conta selecionada.`);
    }
    return byId;
  }

  const byName = inboxes.filter((item) => normalizeText(item?.name) === normalizeText(inboxName));
  if (byName.length === 0) {
    throw new Error(`Inbox '${inboxName}' não encontrada na conta selecionada.`);
  }

  const preferredProvider = normalizeText(inboxProvider);
  const providerMatch = byName.find((item) => normalizeText(item?.provider).includes(preferredProvider));
  if (providerMatch) return providerMatch;

  const whatsappMatch = byName.find(looksLikeWhatsapp);
  if (whatsappMatch) return whatsappMatch;

  return byName[0];
}

export async function discoverChatwootTarget({ config }) {
  const discoveryClient = createChatwootClient({
    baseUrl: config.chatwoot.baseUrl,
    apiAccessToken: config.chatwoot.apiToken,
    accountId: config.chatwoot.accountId,
    timeoutMs: config.chatwoot.requestTimeoutMs,
  });

  const profile = await discoveryClient.getProfile();
  const accounts = Array.isArray(profile?.accounts) ? profile.accounts : [];
  const account = pickAccount(accounts, config.chatwoot.accountId, config.chatwoot.groupName);
  const accountId = Number(account?.id || 0);
  const inboxes = await discoveryClient.listInboxesByAccount(accountId);
  const inbox = pickInbox(inboxes, config.chatwoot.inboxName, config.chatwoot.inboxId, config.chatwoot.inboxProvider);

  return {
    account: {
      id: accountId,
      name: account?.name || null,
      role: account?.role || null,
    },
    inbox: {
      id: Number(inbox?.id || 0),
      name: inbox?.name || null,
      provider: inbox?.provider || null,
      channel_type: inbox?.channel_type || null,
      phone_number: inbox?.phone_number || null,
    },
    all_accounts: accounts.map((item) => ({
      id: Number(item?.id || 0),
      name: item?.name || null,
      role: item?.role || null,
    })),
  };
}

async function listAllConversations({ chatwootClient, accountId, inboxId, maxPages }) {
  const all = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await chatwootClient.listConversationsPage({ inboxId, page, status: "all", accountId });

    if (payload.length === 0) {
      break;
    }

    all.push(...payload);
  }

  return all;
}




export async function buildDailyConversationLogs({ config, date }) {
  assertYmd(date);

  const toYmd = (unixSeconds) => toYmdInTimezone(unixSeconds, config.timezone);
  const target = await discoverChatwootTarget({ config });
  const chatwootClient = createChatwootClient({
    baseUrl: config.chatwoot.baseUrl,
    apiAccessToken: config.chatwoot.apiToken,
    accountId: target.account.id,
    timeoutMs: config.chatwoot.requestTimeoutMs,
  });

  const allConversations = await listAllConversations({
    chatwootClient,
    accountId: target.account.id,
    inboxId: target.inbox.id,
    maxPages: config.chatwoot.maxPages,
  });
  const scopedToInbox = allConversations.filter((conversation) => {
    const inboxId = Number(conversation?.inbox_id || 0);
    return inboxId === Number(target.inbox.id);
  });
  console.log(
    `[preview-day] scan concluido: ${scopedToInbox.length} conversas varridas na inbox ${target.inbox.id} (conta ${target.account.id}).`,
  );

  const enteredToday = extractEnteredToday(scopedToInbox, date, toYmd);
  const activeToday = extractActiveOnDay(scopedToInbox, date, toYmd);
  const selectedConversations = unique(
    [...enteredToday, ...activeToday]
      .map((conversation) => Number(conversation?.id || 0))
      .filter((id) => id > 0),
  )
    .map((id) => scopedToInbox.find((conversation) => Number(conversation?.id || 0) === id))
    .filter(Boolean);
  const detailed = [];

  for (const conversation of selectedConversations) {
    const conversationId = Number(conversation?.id || 0);
    if (!conversationId) continue;

    const [conversationDetail, endpointMessages] = await Promise.all([
      chatwootClient.getConversation(conversationId, target.account.id),
      chatwootClient.getConversationMessages(conversationId, target.account.id),
    ]);

    const normalized = normalizeConversationLog({
      conversation: conversationDetail,
      messages: endpointMessages,
    });

    normalized.messages = attachDay(normalized.messages, toYmd).filter((item) => item.date_ymd === date);
    normalized.total_messages_day = normalized.messages.length;
    const formName = extractNameFromFormMessages(normalized.messages);
    normalized.contact = {
      ...normalized.contact,
      name: mergeContactDisplayName(normalized.contact?.name, formName) || null,
    };

    detailed.push(normalized);
  }
  const carryOverCount = Math.max(0, detailed.length - enteredToday.length);
  console.log(
    `[preview-day] conversas do dia ${date}: ${detailed.length} (entraram no dia: ${enteredToday.length}; ativas de dias anteriores: ${carryOverCount}).`,
  );

  const uniqueContacts = unique(detailed.map((item) => item.contact?.id || item.contact?.identifier));
  const contactLogs = buildContactLogs(detailed);

  return {
    date,
    timezone: config.timezone,
    account: target.account,
    inbox: target.inbox,
    total_conversations_in_inbox_scan: allConversations.length,
    conversations_entered_today: enteredToday.length,
    unique_contacts_today: uniqueContacts.length,
    logs_by_conversation: detailed,
    contact_logs: contactLogs,
  };
}

export async function buildDailyOverview({ config, date }) {
  const snapshot = await buildDailyConversationLogs({ config, date });
  const nowUnix = nowUnixSeconds();

  const conversationOperational = snapshot.logs_by_conversation.map((log) => {
    const state = deriveConversationOperationalState(log, config.timezone, nowUnix);
    return {
      conversation_id: log.conversation_id,
      contact: log.contact,
      contact_key: getContactKey(log),
      status: log.status,
      labels: state.labels,
      finalization_status: state.finalization_status,
      finalization_reason: state.finalization_reason,
      finalization_actor: state.finalization_actor,
      waiting_on_agent: state.waiting_on_agent,
      waiting_on_customer: state.waiting_on_customer,
      pending_since_at: state.pending_since_at,
      pending_since_at_local: state.pending_since_at_local,
      last_interaction_at: state.last_interaction_at,
      last_interaction_at_local: state.last_interaction_at_local,
      trigger_after_1h_at: state.trigger_after_1h_at,
      trigger_after_1h_at_local: state.trigger_after_1h_at_local,
      trigger_ready: state.trigger_ready,
      minutes_to_trigger: state.minutes_to_trigger,
      minutes_overdue: state.minutes_overdue,
      message_count_day: log.total_messages_day || 0,
      unread_count: Number(log.unread_count || 0),
    };
  });

  const insights = snapshot.logs_by_conversation
    .flatMap((log) => {
      const state = deriveConversationOperationalState(log, config.timezone, nowUnix);
      return buildConversationInsights(log, state);
    })
    .sort((a, b) => b.severity_rank - a.severity_rank || a.conversation_id - b.conversation_id);

  const criticalCount = insights.filter((item) => item.severity === "critical").length;
  const nonCriticalCount = insights.length - criticalCount;
  const finalizedCount = conversationOperational.filter((item) => item.finalization_status === "finalizada").length;
  const continuedCount = conversationOperational.length - finalizedCount;
  const triggerReadyCount = conversationOperational.filter((item) => item.trigger_ready).length;
  const totalMessages = snapshot.logs_by_conversation.reduce((acc, log) => acc + Number(log.total_messages_day || 0), 0);
  const identifierUsage = new Map<string, Set<string>>();

  for (const log of snapshot.logs_by_conversation) {
    const identifierKey = normalizeIdentifierKey(log.contact?.identifier);
    if (!identifierKey) continue;
    if (!identifierUsage.has(identifierKey)) {
      identifierUsage.set(identifierKey, new Set<string>());
    }
    identifierUsage.get(identifierKey)?.add(String(log.contact?.id || getContactKey(log)));
  }

  const repeatedIdentifierCount = [...identifierUsage.values()].filter((set) => set.size > 1).length;

  return {
    date: snapshot.date,
    timezone: snapshot.timezone,
    generated_at: new Date().toISOString(),
    account: snapshot.account,
    inbox: snapshot.inbox,
    overview: {
      conversations_scanned: snapshot.total_conversations_in_inbox_scan,
      conversations_entered_today: snapshot.conversations_entered_today,
      unique_contacts_today: snapshot.unique_contacts_today,
      conversations_total_analyzed_day: snapshot.logs_by_conversation.length,
      total_analysis_count: snapshot.contact_logs.length,
      total_messages_day: totalMessages,
      repeated_identifier_count: repeatedIdentifierCount,
      finalized_count: finalizedCount,
      continued_count: continuedCount,
      trigger_ready_count: triggerReadyCount,
      critical_insights_count: criticalCount,
      non_critical_insights_count: nonCriticalCount,
      insights_total: insights.length,
    },
    conversation_operational: conversationOperational,
    insights,
  };
}

export async function runDailyAnalysis({
  config,
  date,
  snapshot = null,
  onProgress = null,
  mode = "reuse",
}: {
  config: any;
  date: string;
  snapshot?: any;
  onProgress?: any;
  mode?: "reuse" | "force";
}) {
  if (!config.dify.apiKey) {
    throw new Error("DIFY_API_KEY não configurada. Configure para rodar /api/analyze-day.");
  }

  const dailySnapshot = snapshot || (await buildDailyConversationLogs({ config, date }));
  const difyClient = createDifyClient({
    ...config.dify,
    timezone: config.timezone,
  });

  const analyses = [];
  const failures = [];
  const totalToProcess = dailySnapshot.contact_logs.length;
  const notify = typeof onProgress === "function" ? onProgress : null;
  const nowUnix = nowUnixSeconds();
  const operationalByConversation = new Map();
  const allConversationIds = unique(
    (dailySnapshot.logs_by_conversation || [])
      .map((item) => Number(item?.conversation_id || 0))
      .filter((id) => id > 0),
  )
    .map((id) => Number(id || 0))
    .filter((id) => id > 0);
  const incrementalContext = await getConversationDeltaStates({
    config,
    account: dailySnapshot.account,
    inbox: {
      id: dailySnapshot.inbox.id,
      name: dailySnapshot.inbox.name,
      provider: dailySnapshot.inbox.provider,
    },
    conversationIds: allConversationIds,
  });
  const incrementalStates = incrementalContext.statesByConversationId;
  const incrementalUpdates = [];

  for (const conversationLog of dailySnapshot.logs_by_conversation || []) {
    const state = deriveConversationOperationalState(conversationLog, config.timezone, nowUnix);
    operationalByConversation.set(Number(conversationLog?.conversation_id || 0), state);
  }

  for (let index = 0; index < dailySnapshot.contact_logs.length; index += 1) {
    const log = dailySnapshot.contact_logs[index];
    const contactKey = log.analysis_key || log.contact_key;
    const contactName = log.contact?.name || log.contact?.identifier || log.contact_key;
    const logText = renderLogForPrompt(log);
    const sourceFingerprint = buildSourceFingerprint(logText);
    const sequence = index + 1;
    const primaryConversationId = Number(log?.conversation_ids?.[0] || 0);
    const operationalState = operationalByConversation.get(primaryConversationId) || null;
    const previousDelta = primaryConversationId > 0 ? incrementalStates.get(primaryConversationId) || null : null;
    const newMessages = filterNewMessages(log.messages || [], previousDelta?.lastAnalyzedMessageId ?? null);
    const deltaHash = buildDeltaHash({
      conversationId: primaryConversationId || Number(log?.conversation_id || 0) || 0,
      status: log?.status || null,
      labels: operationalState?.labels || log?.labels || [],
      messages: newMessages,
    });
    const relevance =
      mode === "force"
        ? { relevant: true, score: 999, reasons: ["modo reprocessar forçado"], hasCriticalRule: true }
        : evaluateDeltaRelevance({
            newMessages,
            previous: previousDelta
              ? {
                  lastAnalyzedMessageId: previousDelta.lastAnalyzedMessageId,
                  lastStatus: previousDelta.lastStatus,
                  lastLabels: previousDelta.lastLabels || [],
                  lastMessageRole: previousDelta.lastMessageRole,
                }
              : null,
            currentLabels: operationalState?.labels || log?.labels || [],
            currentStatus: log?.status || null,
            unansweredMinutes: Number(operationalState?.minutes_overdue || 0),
            unansweredThresholdMinutes: Number(config?.incremental?.unansweredMinutesThreshold || 30),
          });
    const isRelevantDelta =
      mode === "force"
        ? true
        : Boolean(relevance?.hasCriticalRule) ||
          Number(relevance?.score || 0) >= Number(config?.incremental?.minRelevanceScore || 2);
    const previousFullAt = previousDelta?.lastFullAt ? new Date(previousDelta.lastFullAt) : null;
    const fullRebaseDays = Number(config?.incremental?.fullRebaseDays || 7);
    const staleFull =
      !previousFullAt ||
      Number.isNaN(previousFullAt.getTime()) ||
      (Date.now() - previousFullAt.getTime()) / (1000 * 60 * 60 * 24) >= fullRebaseDays;
    const previousStatus = String(previousDelta?.lastStatus || "").toLowerCase();
    const currentStatus = String(log?.status || "").toLowerCase();
    const previousLabels = new Set((previousDelta?.lastLabels || []).map((label) => String(label || "").toLowerCase().trim()));
    const currentLabels = new Set((operationalState?.labels || log?.labels || []).map((label) => String(label || "").toLowerCase().trim()));
    const enteredOutOfAiLabel =
      (!previousLabels.has("lead_agendado") && currentLabels.has("lead_agendado")) ||
      (!previousLabels.has("pausar_ia") && currentLabels.has("pausar_ia"));
    const statusIncoherence =
      (previousStatus === "resolved" && currentStatus === "open" && !enteredOutOfAiLabel) ||
      (previousLabels.has("lead_agendado") && currentStatus === "open" && !currentLabels.has("lead_agendado"));
    const shouldForceFull = mode === "force" || staleFull || statusIncoherence;
    const shouldRunAi =
      shouldForceFull ||
      !previousDelta ||
      !previousDelta.stateSummary ||
      isRelevantDelta;
    const analysisMode: "full" | "delta" =
      shouldForceFull || !previousDelta || !previousDelta.stateSummary ? "full" : "delta";
    const difyDeltaInputs = {
      state_summary_anterior: previousDelta?.stateSummary || null,
      new_messages: newMessages,
      event_context: {
        status: log?.status || null,
        labels: operationalState?.labels || log?.labels || [],
        assignee: null,
        unanswered_minutes: Number(operationalState?.minutes_overdue || 0),
        inactivity_window_minutes: Number(config?.incremental?.unansweredMinutesThreshold || 30),
      },
      conversation_id: primaryConversationId || null,
      contact_key: contactKey || null,
    };

    if (notify) {
      notify({
        type: "contact_start",
        sequence,
        total: totalToProcess,
        contact_key: log.contact_key,
        analysis_key: log.analysis_key || null,
        contact_name: contactName,
        conversation_ids: log.conversation_ids,
      });
    }

    try {
      const latestDbAnalysis =
        mode === "reuse" && !shouldRunAi
          ? await getLatestConversationAnalysis({
              config,
              account: dailySnapshot.account,
              inbox: {
                id: dailySnapshot.inbox.id,
                name: dailySnapshot.inbox.name,
                provider: dailySnapshot.inbox.provider,
              },
              conversationIds: log.conversation_ids || [],
            })
          : null;
      const cachedAnalysis =
        mode === "reuse" && !latestDbAnalysis
          ? await getCachedAnalysisByFingerprint({
              config,
              account: dailySnapshot.account,
              inbox: {
                id: dailySnapshot.inbox.id,
                name: dailySnapshot.inbox.name,
                provider: dailySnapshot.inbox.provider,
              },
              conversationIds: log.conversation_ids || [],
              sourceFingerprint,
            })
          : null;

      const difyHistoryUser = `${config.dify.userPrefix || "chatwoot-contact"}-${contactKey || "unknown"}`;
      const recoveredFromHistory = mode !== "reuse" || cachedAnalysis || latestDbAnalysis
        ? null
        : await difyClient.recoverAnalysisFromHistory({
            user: difyHistoryUser,
            date,
            sourceFingerprint,
            logText,
          });

      let difyRaw = latestDbAnalysis
        ? {
            answer: latestDbAnalysis.answer,
            mode: "incremental",
            event: "delta_not_relevant_reused_latest_analysis",
          }
        : cachedAnalysis
        ? {
            answer: cachedAnalysis.answer,
            mode: "cache",
            event: "cached_hit",
          }
        : recoveredFromHistory
          ? {
              answer: recoveredFromHistory.answer,
              mode: "history",
              event: "history_recovered",
              conversation_id: recoveredFromHistory.conversation_id || null,
              message_id: recoveredFromHistory.message_id || null,
            }
          : await difyClient.analyzeLog({
                contactKey,
                date,
                logText,
                analysisMode,
                extraInputs: difyDeltaInputs,
              });

      if (!difyRaw && !shouldRunAi) {
        difyRaw = await difyClient.analyzeLog({
          contactKey,
          date,
          logText,
          analysisMode: "full",
          extraInputs: difyDeltaInputs,
        });
      }

      const difyAnswer = extractDifyAnswer(difyRaw);
      if (!difyRaw || !difyAnswer) {
        const missingError = new Error(
          "Não encontramos análise disponível para este contato nesta execução.",
        );
        (missingError as Error & { code?: string }).code = "analysis_not_found_in_reuse_mode";
        throw missingError;
      }

      difyRaw.answer = difyAnswer;
      const parsed = tryParseJson(difyAnswer);
      const summaryText =
        String(parsed?.resumo || "").trim() ||
        String(operationalState?.finalization_reason || "").trim() ||
        previousDelta?.stateSummary ||
        null;
      const lastMessageId = getLastMessageId(log.messages || []);
      const lastMessage = (log.messages || []).slice().sort((a, b) => Number(a?.created_at || 0) - Number(b?.created_at || 0)).pop();
      if (primaryConversationId > 0) {
        incrementalUpdates.push({
          chatwootConversationId: primaryConversationId,
          lastAnalyzedMessageId: lastMessageId,
          lastAnalyzedAt: new Date().toISOString(),
          lastMessageAt: lastMessage?.created_at ? new Date(Number(lastMessage.created_at) * 1000).toISOString() : null,
          lastMessageRole: lastMessage?.role || null,
          stateSummary: summaryText,
          lastDeltaHash: deltaHash,
          lastStatus: log?.status || null,
          lastLabels: operationalState?.labels || log?.labels || [],
          lastFullAt: analysisMode === "full" ? new Date().toISOString() : previousDelta?.lastFullAt || null,
          lastRunMode: analysisMode,
        });
      }

      analyses.push({
        analysis_index: sequence,
        analysis_key: log.analysis_key,
        source_fingerprint: sourceFingerprint,
        incremental: {
          should_run_ai: shouldRunAi,
          delta_message_count: newMessages.length,
          delta_relevance_score: relevance.score,
          delta_relevance_reasons: relevance.reasons,
          delta_relevant: isRelevantDelta,
          delta_hash: deltaHash,
          forced_full: shouldForceFull,
          forced_full_reason: mode === "force" ? "modo force" : staleFull ? "rebase periódico" : statusIncoherence ? "incoerência de status/labels" : null,
          analysis_mode: analysisMode,
        },
        contact_key: log.contact_key,
        contact: log.contact,
        conversation_ids: log.conversation_ids,
        conversation_operational: log.conversation_ids
          .map((id) => ({ conversation_id: Number(id), state: operationalByConversation.get(Number(id)) || null }))
          .filter((entry) => entry.state),
        message_count_day: log.message_count_day,
        log_text: logText,
        responsible_tracking: buildResponsibleTracking(log.messages || []),
        analysis: compactAnalysis(difyRaw),
      });
      console.log(
        `[analyze-day] contato ${log.contact_key} ${
          latestDbAnalysis
            ? "reaproveitado do último estado (delta sem impacto)"
            : cachedAnalysis
              ? "reaproveitado do cache"
              : recoveredFromHistory
                ? "recuperado do histórico Dify"
                : "analisado"
        } (${analyses.length + failures.length}/${totalToProcess}).`,
      );
      if (notify) {
        notify({
          type: "contact_done",
          sequence,
          total: totalToProcess,
          contact_key: log.contact_key,
          analysis_key: log.analysis_key || null,
          contact_name: contactName,
          conversation_ids: log.conversation_ids,
          success: true,
          processed: analyses.length + failures.length,
        });
      }
    } catch (error) {
      failures.push({
        analysis_index: sequence,
        analysis_key: log.analysis_key,
        contact_key: log.contact_key,
        contact: log.contact,
        conversation_ids: log.conversation_ids,
        message_count_day: log.message_count_day,
        error_message: error.message,
        error_code: error.code || null,
        error_status: error.status || null,
      });
      console.error(
        `[analyze-day] falha no contato ${log.contact_key} (${analyses.length + failures.length}/${totalToProcess}): ${error.message}`,
      );
      if (notify) {
        notify({
          type: "contact_done",
          sequence,
          total: totalToProcess,
          contact_key: log.contact_key,
          analysis_key: log.analysis_key || null,
          contact_name: contactName,
          conversation_ids: log.conversation_ids,
          success: false,
          processed: analyses.length + failures.length,
          error_message: error.message,
          error_code: error.code || null,
        });
      }
    }
  }

  if (incrementalUpdates.length > 0) {
    await upsertConversationDeltaStates({
      tenantId: incrementalContext.tenantId,
      channelId: incrementalContext.channelId,
      items: incrementalUpdates,
    });
  }

  return {
    ...dailySnapshot,
    analyses,
    failures,
    run_stats: {
      total_to_process: totalToProcess,
      processed: analyses.length + failures.length,
      success_count: analyses.length,
      failure_count: failures.length,
      success_rate:
        totalToProcess > 0 ? Number(((analyses.length / totalToProcess) * 100).toFixed(2)) : 0,
    },
  };
}

export async function buildDailyReport({
  config,
  date,
  onProgress = null,
  mode = "reuse",
}: {
  config: any;
  date: string;
  onProgress?: any;
  mode?: "reuse" | "force";
}) {
  const snapshot = await buildDailyConversationLogs({ config, date });
  const analysis = await runDailyAnalysis({ config, date, snapshot, onProgress, mode });
  const orderedAnalyses = [...analysis.analyses].sort(
    (a, b) => Number(a?.analysis_index || 0) - Number(b?.analysis_index || 0),
  );
  const orderedFailures = [...(analysis.failures || [])].sort(
    (a, b) => Number(a?.analysis_index || 0) - Number(b?.analysis_index || 0),
  );
  const reportDate = analysis.date;
  const total = orderedAnalyses.length;
  const parsedItems = orderedAnalyses.map((item) => ({
    item,
    parsed: tryParseJson(item?.analysis?.answer),
  }));

  const criticalCount = parsedItems.filter((entry) => {
    const topLevel = String(
      entry.parsed?.severidade || entry.parsed?.severity || entry.parsed?.nivel_risco || entry.parsed?.risco || "",
    )
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (topLevel.startsWith("crit") || topLevel === "critical") return true;

    const gaps = extractGapEntriesFromAnalysis(entry.item);
    return gaps.some((gap) => {
      const raw = String(gap?.severidade || gap?.severity || gap?.nivel || gap?.prioridade || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return raw.startsWith("crit") || raw === "critical";
    });
  }).length;
  const improvementsCount = parsedItems.reduce(
    (acc, entry) => acc + toArray(entry.parsed?.pontos_melhoria).length,
    0,
  );
  const gapsCount = orderedAnalyses.reduce((acc, item) => acc + extractGapEntriesFromAnalysis(item).length, 0);
  const gapsForReport = orderedAnalyses.flatMap((item) => extractGapEntriesFromAnalysis(item));
  const responsiblePerformanceRaw = {
    ia: {
      owner_label: "IA",
      analyses_count: 0,
      contacts_count: 0,
      conversations_count: 0,
      message_count_agent: 0,
      gaps_count: 0,
      critical_gaps_count: 0,
      improvements_count: 0,
      avg_response_sec: null,
      max_response_sec: null,
      response_samples: 0,
      _sum_response_sec: 0,
      _contact_keys: new Set<string>(),
      _conversation_ids: new Set<number>(),
    },
    suellen: {
      owner_label: "Comercial Suellen",
      analyses_count: 0,
      contacts_count: 0,
      conversations_count: 0,
      message_count_agent: 0,
      gaps_count: 0,
      critical_gaps_count: 0,
      improvements_count: 0,
      avg_response_sec: null,
      max_response_sec: null,
      response_samples: 0,
      _sum_response_sec: 0,
      _contact_keys: new Set<string>(),
      _conversation_ids: new Set<number>(),
    },
    samuel: {
      owner_label: "Comercial Samuel",
      analyses_count: 0,
      contacts_count: 0,
      conversations_count: 0,
      message_count_agent: 0,
      gaps_count: 0,
      critical_gaps_count: 0,
      improvements_count: 0,
      avg_response_sec: null,
      max_response_sec: null,
      response_samples: 0,
      _sum_response_sec: 0,
      _contact_keys: new Set<string>(),
      _conversation_ids: new Set<number>(),
    },
  };

  const toSeverityKey = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  for (const entry of parsedItems) {
    const tracking = entry.item?.responsible_tracking || null;
    const ownerBucket = ["ia", "suellen", "samuel"].includes(String(tracking?.owner_bucket || ""))
      ? String(tracking.owner_bucket)
      : "ia";
    const bucketStats = responsiblePerformanceRaw[ownerBucket];
    bucketStats.analyses_count += 1;
    bucketStats.message_count_agent += Number(tracking?.message_count_agent || 0);
    bucketStats.improvements_count += toArray(entry.parsed?.pontos_melhoria).length;

    const contactKey = String(entry.item?.contact_key || "").trim();
    if (contactKey) bucketStats._contact_keys.add(contactKey);
    for (const convId of entry.item?.conversation_ids || []) {
      const id = Number(convId || 0);
      if (id > 0) bucketStats._conversation_ids.add(id);
    }

    const gaps = extractGapEntriesFromAnalysis(entry.item);
    bucketStats.gaps_count += gaps.length;
    for (const gap of gaps) {
      const sev = toSeverityKey(gap?.severidade || gap?.severity || gap?.nivel || gap?.prioridade);
      if (sev.startsWith("crit") || sev === "critical") {
        bucketStats.critical_gaps_count += 1;
      }
    }

    const ownerMetric = tracking?.response_metrics?.[ownerBucket] || null;
    const ownerAvg = Number(ownerMetric?.avg_response_sec || 0);
    const ownerSamples = Number(ownerMetric?.samples || 0);
    if (ownerSamples > 0 && ownerAvg > 0) {
      bucketStats._sum_response_sec += ownerAvg * ownerSamples;
      bucketStats.response_samples += ownerSamples;
      bucketStats.max_response_sec = Math.max(
        Number(bucketStats.max_response_sec || 0),
        Number(ownerMetric?.max_response_sec || 0),
      );
    }
  }

  const responsiblePerformance = {} as Record<string, any>;
  for (const owner of ["ia", "suellen", "samuel"]) {
    const stats = responsiblePerformanceRaw[owner];
    responsiblePerformance[owner] = {
      owner_label: stats.owner_label,
      analyses_count: stats.analyses_count,
      contacts_count: stats._contact_keys.size,
      conversations_count: stats._conversation_ids.size,
      message_count_agent: stats.message_count_agent,
      gaps_count: stats.gaps_count,
      critical_gaps_count: stats.critical_gaps_count,
      improvements_count: stats.improvements_count,
      avg_response_sec:
        stats.response_samples > 0 ? Number((stats._sum_response_sec / stats.response_samples).toFixed(2)) : null,
      max_response_sec: Number(stats.max_response_sec || 0) > 0 ? Number(stats.max_response_sec) : null,
      response_samples: stats.response_samples,
    };
  }

  const chatwootAppBase = toChatwootAppBase(config.chatwoot.baseUrl);

  const lines = [];
  lines.push(`# Relatório Diário - Auditoria de Atendimento`);
  lines.push("");
  lines.push(`- Data: ${reportDate}`);
  lines.push(`- Conta: ${analysis.account?.name || "-"} (id ${analysis.account?.id || "-"})`);
  lines.push(`- Canal: ${analysis.inbox?.name || "-"} (id ${analysis.inbox?.id || "-"})`);
  lines.push(`- Conversas que entraram no dia: ${analysis.conversations_entered_today}`);
  lines.push(`- Contatos únicos: ${analysis.unique_contacts_today}`);
  lines.push(`- Análises executadas: ${total}`);
  lines.push(`- Casos com risco crítico: ${criticalCount}`);
  lines.push(`- Total de pontos de melhoria citados: ${improvementsCount}`);
  lines.push(`- Total de gaps operacionais citados: ${gapsCount}`);
  lines.push("");
  lines.push(`## Desempenho por Responsável`);
  lines.push("");
  for (const owner of ["ia", "suellen", "samuel"]) {
    const stats = responsiblePerformance[owner];
    lines.push(`### ${stats.owner_label}`);
    lines.push(`- Análises: ${stats.analyses_count}`);
    lines.push(`- Contatos únicos: ${stats.contacts_count}`);
    lines.push(`- Conversas únicas: ${stats.conversations_count}`);
    lines.push(`- Mensagens de agente rastreadas: ${stats.message_count_agent}`);
    lines.push(`- Gaps totais: ${stats.gaps_count}`);
    lines.push(`- Gaps críticos: ${stats.critical_gaps_count}`);
    lines.push(`- Pontos de melhoria: ${stats.improvements_count}`);
    lines.push(
      `- Tempo médio de resposta: ${
        stats.avg_response_sec !== null ? `${Number(stats.avg_response_sec).toFixed(2)}s` : "N/A"
      }`,
    );
    lines.push(
      `- Maior tempo de resposta: ${
        stats.max_response_sec !== null ? `${Number(stats.max_response_sec).toFixed(2)}s` : "N/A"
      }`,
    );
    lines.push(`- Amostras de resposta: ${stats.response_samples}`);
    lines.push("");
  }

  lines.push(`## Detalhamento por Contato`);
  lines.push("");

  orderedAnalyses.forEach((item, idx) => {
    lines.push(
      buildItemSection(item, idx + 1, {
        chatwootAppBase,
        accountId: analysis.account?.id,
        inboxId: analysis.inbox?.id,
      }),
    );
  });

  lines.push(`## Gaps Operacionais`);
  lines.push("");

  if (gapsForReport.length === 0) {
    lines.push("Nenhum gap operacional identificado pela IA neste dia.");
    lines.push("");
  } else {
    for (const gap of gapsForReport) {
      lines.push(buildGapSection(gap));
    }
  }

  return {
    date: reportDate,
    account: analysis.account,
    inbox: analysis.inbox,
    summary: {
      conversations_entered_today: analysis.conversations_entered_today,
      unique_contacts_today: analysis.unique_contacts_today,
      total_to_process: analysis.run_stats?.total_to_process || analysis.analyses.length,
      processed: analysis.run_stats?.processed || analysis.analyses.length,
      analyses_count: total,
      failures_count: orderedFailures.length || 0,
      critical_count: criticalCount,
      improvements_count: improvementsCount,
      gaps_count: gapsCount,
      responsible_performance: responsiblePerformance,
    },
    report_markdown: lines.join("\n"),
    raw_analysis: {
      ...analysis,
      analyses: orderedAnalyses,
      failures: orderedFailures,
    },
  };
}






