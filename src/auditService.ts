import { createChatwootClient } from "./chatwootClient";
import { createDifyClient } from "./difyClient";
import { attachDay, normalizeConversationLog, renderLogForPrompt } from "./chatMapper";
import { assertYmd, formatDateTimeInTimezone, nowUnixSeconds, toYmdInTimezone, unique } from "./dateUtils";

const FINALIZATION_LABELS = ["lead_agendado", "pausar_ia"];
const FINALIZATION_STATUSES = ["resolved", "closed"];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function looksLikeWhatsapp(inbox) {
  const provider = normalizeText(inbox?.provider);
  const channelType = normalizeText(inbox?.channel_type);
  return provider.includes("whatsapp") || channelType.includes("whatsapp");
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

function extractEnteredToday(conversations, date, toYmd) {
  return conversations.filter((item) => {
    const createdAt = Number(item?.created_at || 0);
    if (!createdAt) return false;
    return toYmd(createdAt) === date;
  });
}

function compactAnalysis(raw) {
  return {
    answer: raw?.answer || null,
    event: raw?.event || null,
    mode: raw?.mode || null,
    workflow_status: raw?.data?.status || null,
    workflow_outputs: raw?.data?.outputs || null,
    tokens: raw?.metadata?.usage?.total_tokens || raw?.data?.total_tokens || null,
    elapsed_time: raw?.metadata?.usage?.latency || raw?.data?.elapsed_time || null,
    raw,
  };
}

function getContactKey(log) {
  return String(log.contact?.id || log.contact?.identifier || `conversation-${log.conversation_id}`);
}

function normalizeIdentifierKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  return digits || raw.toLowerCase();
}

function buildContactLogs(conversationLogs) {
  const map = new Map();

  for (const log of conversationLogs) {
    const baseContactKey = getContactKey(log);
    const key = `${baseContactKey}::conversation-${log.conversation_id}`;

    if (!map.has(key)) {
      map.set(key, {
        analysis_key: key,
        contact_key: baseContactKey,
        contact: log.contact,
        conversation_ids: [],
        messages: [],
      });
    }

    const entry = map.get(key);
    entry.conversation_ids.push(log.conversation_id);

    for (const message of log.messages) {
      entry.messages.push({
        ...message,
        conversation_id: log.conversation_id,
      });
    }
  }

  return [...map.values()].map((item) => ({
    ...item,
    conversation_ids: unique(item.conversation_ids),
    messages: item.messages.sort((a, b) => a.created_at - b.created_at),
    message_count_day: item.messages.length,
  }));
}

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.map((label) => String(label || "").trim().toLowerCase()).filter(Boolean);
}

function severityRank(severity) {
  const normalized = String(severity || "").toLowerCase();
  if (normalized === "critical") return 5;
  if (normalized === "high") return 4;
  if (normalized === "medium") return 3;
  if (normalized === "low") return 2;
  return 1;
}

function findLastHumanMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    const role = String(message?.role || "").toUpperCase();
    if (role === "USER" || role === "AGENT") {
      return message;
    }
  }
  return null;
}

function extractFinalizationActor(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = String(messages[i]?.text || "").trim();
    if (!text) continue;
    const resolvedBy = text.match(/marcada como resolvida por\s+(.+?)\./i);
    if (resolvedBy?.[1]) return resolvedBy[1].trim();
    const statusBy = text.match(/status alterado para\s+\".+?\"\s+por\s+(.+?)\./i);
    if (statusBy?.[1]) return statusBy[1].trim();
  }
  return null;
}

function deriveConversationOperationalState(log, timezone, referenceNowUnix) {
  const labelsLower = normalizeLabels(log.labels);
  const finalLabel = FINALIZATION_LABELS.find((tag) => labelsLower.includes(tag)) || null;
  const finalByLabel = Boolean(finalLabel);
  const finalByStatus = FINALIZATION_STATUSES.includes(String(log.status || "").toLowerCase());
  const finalizationActor = extractFinalizationActor(log.messages);

  const lastMessageAt = log.messages.reduce((acc, message) => Math.max(acc, Number(message?.created_at || 0)), 0);
  const lastHumanMessage = findLastHumanMessage(log.messages);
  const lastHumanRole = String(lastHumanMessage?.role || "").toUpperCase();
  const waitingOnAgent = lastHumanRole === "USER";
  const waitingOnCustomer = lastHumanRole === "AGENT";
  const pendingSinceAt = waitingOnAgent ? Number(lastHumanMessage?.created_at || 0) : 0;
  const lastInteractionAtRaw = Math.max(
    lastMessageAt,
    Number(log.last_activity_at || 0),
    Number(log.updated_at || 0),
    Number(log.timestamp || 0),
    Number(log.created_at || 0),
  );
  const lastInteractionAt = lastInteractionAtRaw ? Math.floor(lastInteractionAtRaw) : 0;
  const triggerAt = pendingSinceAt ? pendingSinceAt + 3600 : 0;
  const triggerReady = waitingOnAgent && triggerAt > 0 ? referenceNowUnix >= triggerAt : false;
  const secondsToTrigger = triggerAt > 0 ? triggerAt - referenceNowUnix : 0;
  const minutesToTrigger = waitingOnAgent && !triggerReady ? Math.max(0, Math.ceil(secondsToTrigger / 60)) : 0;
  const minutesOverdue = waitingOnAgent && triggerReady ? Math.floor((referenceNowUnix - triggerAt) / 60) : 0;

  const finalizationStatus = finalByLabel || finalByStatus ? "finalizada" : "continuada";
  const baseFinalizationReason = finalByLabel
    ? `etiqueta:${finalLabel}`
    : finalByStatus
      ? `status:${String(log.status || "").toLowerCase()}`
      : "sem_finalizacao";
  const finalizationReason = finalizationActor
    ? `${baseFinalizationReason} por ${finalizationActor}`
    : baseFinalizationReason;

  return {
    labels: labelsLower,
    finalization_status: finalizationStatus,
    finalization_reason: finalizationReason,
    finalization_actor: finalizationActor,
    waiting_on_agent: waitingOnAgent,
    waiting_on_customer: waitingOnCustomer,
    last_human_role: lastHumanRole || null,
    pending_since_at: pendingSinceAt || null,
    pending_since_at_local: formatDateTimeInTimezone(pendingSinceAt, timezone),
    last_interaction_at: lastInteractionAt || null,
    last_interaction_at_local: formatDateTimeInTimezone(lastInteractionAt, timezone),
    trigger_after_1h_at: triggerAt || null,
    trigger_after_1h_at_local: formatDateTimeInTimezone(triggerAt, timezone),
    trigger_ready: triggerReady,
    minutes_to_trigger: minutesToTrigger,
    minutes_overdue: minutesOverdue,
  };
}

function buildConversationInsights(log, state) {
  const baseContactName = log.contact?.name || log.contact?.identifier || `Contato ${log.conversation_id}`;
  const contactIdentifier = String(log.contact?.identifier || "").trim();
  const contactName = contactIdentifier && !baseContactName.includes(contactIdentifier)
    ? `${baseContactName} • ${contactIdentifier}`
    : baseContactName;
  const insights = [];

  if (state.finalization_status === "finalizada") {
    const byWho = state.finalization_actor ? `**${state.finalization_actor}**` : state.finalization_reason;
    insights.push({
      type: "finalization",
      severity: "low",
      title: "Conversa finalizada",
      summary: `Conversa marcada como finalizada por ${byWho}.`,
    });
  } else if (state.waiting_on_customer) {
    insights.push({
      type: "customer_pending",
      severity: "info",
      title: "Aguardando retorno do cliente",
      summary: `Última mensagem enviada pela IA/atendente em ${state.last_interaction_at_local}.`,
    });
  } else if (state.trigger_ready) {
    let severity = "medium";
    if (state.minutes_overdue >= 120) severity = "critical";
    else if (state.minutes_overdue >= 60) severity = "high";

    insights.push({
      type: "followup_delay",
      severity,
      title: "Cliente sem resposta após gatilho de 1h",
      summary: `Cliente aguardando resposta há ${state.minutes_overdue} min após o gatilho de 1h.`,
    });
  } else {
    insights.push({
      type: "followup_window",
      severity: "info",
      title: "Cliente aguardando resposta",
      summary: `Ainda faltam ${state.minutes_to_trigger} min para acionar o gatilho de 1h sem resposta.`,
    });
  }

  return insights.map((insight, idx) => ({
    ...insight,
    id: `${log.conversation_id}-${idx + 1}`,
    severity_rank: severityRank(insight.severity),
    conversation_id: log.conversation_id,
    contact_key: getContactKey(log),
    contact_name: contactName,
    contact: log.contact,
    labels: state.labels,
    finalization_status: state.finalization_status,
    finalization_reason: state.finalization_reason,
    finalization_actor: state.finalization_actor || null,
    status: log.status || null,
    unread_count: Number(log.unread_count || 0),
    last_interaction_at: state.last_interaction_at,
    last_interaction_at_local: state.last_interaction_at_local,
    trigger_after_1h_at: state.trigger_after_1h_at,
    trigger_after_1h_at_local: state.trigger_after_1h_at_local,
    trigger_ready: state.trigger_ready,
    minutes_to_trigger: state.minutes_to_trigger,
    minutes_overdue: state.minutes_overdue,
  }));
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
  console.log(`[preview-day] scan concluido: ${allConversations.length} conversas varridas na inbox ${target.inbox.id}.`);

  const enteredToday = extractEnteredToday(allConversations, date, toYmd);
  const detailed = [];

  for (const conversation of enteredToday) {
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

    detailed.push(normalized);
  }
  console.log(`[preview-day] conversas do dia ${date}: ${detailed.length}.`);

  const uniqueContacts = unique(detailed.map((item) => item.contact?.id || item.contact?.identifier));
  const contactLogs = buildContactLogs(detailed);

  return {
    date,
    timezone: config.timezone,
    account: target.account,
    inbox: target.inbox,
    total_conversations_in_inbox_scan: allConversations.length,
    conversations_entered_today: detailed.length,
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

export async function runDailyAnalysis({ config, date, snapshot = null, onProgress = null }) {
  if (!config.dify.apiKey) {
    throw new Error("DIFY_API_KEY não configurada. Configure para rodar /api/analyze-day.");
  }

  const dailySnapshot = snapshot || (await buildDailyConversationLogs({ config, date }));
  const difyClient = createDifyClient(config.dify);

  const analyses = [];
  const failures = [];
  const totalToProcess = dailySnapshot.contact_logs.length;
  const notify = typeof onProgress === "function" ? onProgress : null;
  const nowUnix = nowUnixSeconds();
  const operationalByConversation = new Map();

  for (const conversationLog of dailySnapshot.logs_by_conversation || []) {
    const state = deriveConversationOperationalState(conversationLog, config.timezone, nowUnix);
    operationalByConversation.set(Number(conversationLog?.conversation_id || 0), state);
  }

  for (let index = 0; index < dailySnapshot.contact_logs.length; index += 1) {
    const log = dailySnapshot.contact_logs[index];
    const contactKey = log.analysis_key || log.contact_key;
    const contactName = log.contact?.name || log.contact?.identifier || log.contact_key;
    const logText = renderLogForPrompt(log);
    const sequence = index + 1;

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
      const difyRaw = await difyClient.analyzeLog({
        contactKey,
        date,
        logText,
      });

      analyses.push({
        analysis_index: sequence,
        analysis_key: log.analysis_key,
        contact_key: log.contact_key,
        contact: log.contact,
        conversation_ids: log.conversation_ids,
        conversation_operational: log.conversation_ids
          .map((id) => ({ conversation_id: Number(id), state: operationalByConversation.get(Number(id)) || null }))
          .filter((entry) => entry.state),
        message_count_day: log.message_count_day,
        log_text: logText,
        analysis: compactAnalysis(difyRaw),
      });
      console.log(
        `[analyze-day] contato ${log.contact_key} analisado (${analyses.length + failures.length}/${totalToProcess}).`,
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

function tryParseJson(text) {
  if (!text) return null;

  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
  if (!fencedMatch) return null;

  try {
    return JSON.parse(fencedMatch[1]);
  } catch {
    return null;
  }
}

function toArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item === null || item === undefined) return "";

      if (typeof item === "string") {
        return item.trim();
      }

      if (typeof item === "number" || typeof item === "boolean") {
        return String(item);
      }

      if (typeof item === "object") {
        const flatEntries = Object.entries(item).filter(
          ([, fieldValue]) =>
            fieldValue !== null &&
            fieldValue !== undefined &&
            (typeof fieldValue === "string" || typeof fieldValue === "number" || typeof fieldValue === "boolean"),
        );

        if (flatEntries.length > 0) {
          return flatEntries
            .map(([fieldKey, fieldValue]) => `${fieldKey}: ${String(fieldValue)}`)
            .join(" | ");
        }

        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      }

      return String(item).trim();
    })
    .filter(Boolean);
}

function pickFirstText(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizeSeverity(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "Não informado";
  if (value.startsWith("alt")) return "Alta";
  if (value.startsWith("med")) return "Média";
  if (value.startsWith("baix")) return "Baixa";
  return String(raw).trim();
}

function toChatwootAppBase(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    const cleanedPath = parsed.pathname
      .replace(/\/+$/, "")
      .replace(/\/api\/v1(?:\/.*)?$/i, "")
      .replace(/\/api(?:\/.*)?$/i, "");
    return `${parsed.origin}${cleanedPath}`.replace(/\/+$/, "");
  } catch {
    return raw
      .replace(/\/+$/, "")
      .replace(/\/api\/v1(?:\/.*)?$/i, "")
      .replace(/\/api(?:\/.*)?$/i, "");
  }
}

function buildConversationLink(baseUrl, accountId, inboxId, conversationId) {
  if (!baseUrl || !accountId || !inboxId || !conversationId) return null;
  return `${baseUrl}/app/accounts/${accountId}/inbox/${inboxId}/conversations/${conversationId}`;
}

function extractGapEntriesFromAnalysis(item) {
  const parsed = tryParseJson(item?.analysis?.answer);
  const gapsRaw = Array.isArray(parsed?.gaps_operacionais) ? parsed.gaps_operacionais : [];
  const contactName = item?.contact?.name || item?.contact?.identifier || item?.contact_key || "Contato sem nome";

  return gapsRaw.map((rawGap, index) => {
    if (typeof rawGap === "string") {
      const text = rawGap.trim();
      return {
        name: text || `Gap ${index + 1}`,
        severity: "Não informado",
        description: text || "Não informado",
        messageReference: "Não informado",
        userReportedData: "",
        accessInfinityConfirmedData: "",
        contactName,
      };
    }

    if (!rawGap || typeof rawGap !== "object") {
      return {
        name: `Gap ${index + 1}`,
        severity: "Não informado",
        description: "Não informado",
        messageReference: "Não informado",
        userReportedData: "",
        accessInfinityConfirmedData: "",
        contactName,
      };
    }

    const name =
      pickFirstText(rawGap, ["nome_gap", "nome", "titulo", "title", "gap", "categoria"]) ||
      `Gap ${index + 1} - ${contactName}`;
    const severity = normalizeSeverity(
      pickFirstText(rawGap, ["severidade", "severity", "nivel", "prioridade", "priority"]),
    );
    const description =
      pickFirstText(rawGap, ["descricao", "description", "detalhe", "detalhes", "contexto"]) || "Não informado";
    const messageReference =
      pickFirstText(rawGap, [
        "mensagem_referencia",
        "message_reference",
        "referencia_mensagem",
        "trecho",
        "timestamp",
        "referencia",
      ]) || "Não informado";
    const userReportedData = pickFirstText(rawGap, [
      "dado_informado_pelo_usuario",
      "dado_informado_usuario",
      "dado_informado",
      "valor_informado",
    ]);
    const accessInfinityConfirmedData = pickFirstText(rawGap, [
      "dado_confirmado_pelo_acesso_infinity",
      "dado_confirmado_acesso_infinity",
      "dado_confirmado",
      "valor_confirmado",
    ]);

    return {
      name,
      severity,
      description,
      messageReference,
      userReportedData,
      accessInfinityConfirmedData,
      contactName,
    };
  });
}

function buildGapSection(gap) {
  const lines = [];
  lines.push(`### ${gap.name}`);
  lines.push(`- **Contato:** ${gap.contactName || "Não informado"}`);
  lines.push(`- **Severidade:** ${gap.severity}`);
  lines.push(`- **Descrição:** ${gap.description}`);
  lines.push(`- **Mensagem de referência:** ${gap.messageReference}`);

  if (gap.userReportedData || gap.accessInfinityConfirmedData) {
    lines.push(
      `- **Dado informado pelo usuário:** ${gap.userReportedData || "Não informado"} *(somente para gaps de dado incorreto)*`,
    );
    lines.push(
      `- **Dado confirmado pelo Acesso Infinity:** ${gap.accessInfinityConfirmedData || "Não informado"} *(somente para gaps de dado incorreto)*`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function buildItemSection(
  item,
  index,
  options: { chatwootAppBase?: string; accountId?: number | null; inboxId?: number | null } = {},
) {
  const parsed = tryParseJson(item?.analysis?.answer);
  const contactName = item?.contact?.name || item?.contact?.identifier || item?.contact_key || "Contato sem nome";
  const resumo = parsed?.resumo || "Sem resumo estruturado.";
  const melhorias = toArray(parsed?.pontos_melhoria);
  const gaps = extractGapEntriesFromAnalysis(item);
  const proximos = toArray(parsed?.proximos_passos);
  const risco = Boolean(parsed?.risco_critico);
  const links = (item?.conversation_ids || [])
    .map((conversationId) =>
      buildConversationLink(options.chatwootAppBase, options.accountId, options.inboxId, Number(conversationId)),
    )
    .filter(Boolean);
  const operational = Array.isArray(item?.conversation_operational) ? item.conversation_operational : [];
  const firstState = operational[0]?.state || null;
  const finalizationLabel = firstState
    ? firstState.finalization_status === "finalizada"
      ? firstState.finalization_actor
        ? `**Finalizada por ${firstState.finalization_actor}**`
        : `**Finalizada (${firstState.finalization_reason || "motivo não informado"})**`
      : firstState.waiting_on_agent
        ? "**Aguardando resposta da IA/atendente**"
        : firstState.waiting_on_customer
          ? "**Aguardando retorno do cliente**"
          : "**Em andamento**"
    : "**Estado não identificado**";

  const lines = [];
  lines.push(`### ${index}. ${contactName}`);
  lines.push(`- **Contact key:** \`${item?.contact_key}\``);
  lines.push(`- **Conversas:** ${item?.conversation_ids?.join(", ") || "-"}`);
  lines.push(`- **Links das conversas:** ${links.length > 0 ? links.join(" | ") : "Não disponível"}`);
  lines.push(`- **Mensagens no dia:** ${item?.message_count_day || 0}`);
  lines.push(`- **Status operacional:** ${finalizationLabel}`);
  lines.push(`- **Risco crítico:** ${risco ? "Sim" : "Não"}`);
  lines.push(`- **Resumo:** ${resumo}`);
  lines.push(`- **Pontos de melhoria:** ${melhorias.length > 0 ? melhorias.join(" | ") : "Nenhum apontado"}`);
  lines.push(`- **Gaps operacionais identificados:** ${gaps.length}`);
  lines.push(`- **Próximos passos:** ${proximos.length > 0 ? proximos.join(" | ") : "Nenhum apontado"}`);
  lines.push("");
  return lines.join("\n");
}

export async function buildDailyReport({ config, date, onProgress = null }) {
  const snapshot = await buildDailyConversationLogs({ config, date });
  const analysis = await runDailyAnalysis({ config, date, snapshot, onProgress });
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

  const criticalCount = parsedItems.filter((entry) => Boolean(entry.parsed?.risco_critico)).length;
  const improvementsCount = parsedItems.reduce(
    (acc, entry) => acc + toArray(entry.parsed?.pontos_melhoria).length,
    0,
  );
  const gapsCount = orderedAnalyses.reduce((acc, item) => acc + extractGapEntriesFromAnalysis(item).length, 0);
  const gapsForReport = orderedAnalyses.flatMap((item) => extractGapEntriesFromAnalysis(item));

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
    },
    report_markdown: lines.join("\n"),
    raw_analysis: {
      ...analysis,
      analyses: orderedAnalyses,
      failures: orderedFailures,
    },
  };
}
