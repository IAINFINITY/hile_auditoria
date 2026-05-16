import { GapSeverity, Prisma, RunStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { AppConfig } from "./types";
import type { ReportPayload } from "@/types";
import { buildClientRecordsFromAnalyses } from "./clientRecords";
import { toTitleCaseName } from "./nameFormat";
import {
  allInsightsFromAnalysis,
  asBool,
  asNumOrNull,
  asRecord,
  asStringList,
  buildConversationLink,
  parseGapEntries,
  parseGapSeverity,
  parseInsightSeverity,
  parseJsonSafe,
  pickFirstText,
  resolveTenantAndChannel,
  toChatwootAppBase,
  toDateRef,
  toJsonValue,
  upsertContactByReference,
} from "./persistence/helpers";

const insightSeverityRank: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function normalizeTimelineStatus(value: unknown): string {
  const v = String(value || "").toLowerCase();
  if (v === "resolvido") return "resolvido";
  if (v === "atencao") return "atencao";
  return "aberto";
}

function pickTimelineEventType(params: {
  previousStatus: string | null;
  nextStatus: string;
  movedOutOfAi: boolean;
}): "issue_opened" | "issue_updated" | "issue_resolved" | "moved_out_of_ai" {
  if (params.movedOutOfAi) return "moved_out_of_ai";
  if (params.nextStatus === "resolvido") return "issue_resolved";
  if (!params.previousStatus || params.previousStatus === "resolvido") return "issue_opened";
  return "issue_updated";
}

function hasRenderableReportData(reportJson: Record<string, unknown> | null | undefined): boolean {
  if (!reportJson || typeof reportJson !== "object") return false;
  const rawAnalysis = (reportJson.raw_analysis || {}) as Record<string, unknown>;
  const analyses = Array.isArray(rawAnalysis.analyses) ? rawAnalysis.analyses : [];
  const failures = Array.isArray(rawAnalysis.failures) ? rawAnalysis.failures : [];
  const logs = Array.isArray(reportJson.logs) ? reportJson.logs : [];
  const logsCount = Number(reportJson.logs_count || 0);
  return analyses.length > 0 || failures.length > 0 || logs.length > 0 || logsCount > 0;
}

export async function createRunRecord(params: {
  config: AppConfig;
  date: string;
  startedAtIso: string;
  account?: { id: number; name: string | null };
  inbox?: { id: number; name: string | null; provider: string | null };
}) {
  const baseReportLike = {
    account: params.account || { id: params.config.chatwoot.accountId || 0, name: params.config.chatwoot.groupName },
    inbox: params.inbox || {
      id: params.config.chatwoot.inboxId || 0,
      name: params.config.chatwoot.inboxName,
      provider: params.config.chatwoot.inboxProvider,
    },
  } as ReportPayload;

  return prisma.$transaction(async (tx) => {
    const { tenant, channel } = await resolveTenantAndChannel(tx, params.config, baseReportLike);
    const dateRef = toDateRef(params.date);
    const lockKey = `analysis-run:${tenant.id}:${channel.id}:${params.date}`;

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const staleBefore = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const now = new Date(params.startedAtIso);

    await tx.analysisRun.updateMany({
      where: {
        tenantId: tenant.id,
        channelId: channel.id,
        dateRef,
        status: RunStatus.running,
        startedAt: { lt: staleBefore },
      },
      data: {
        status: RunStatus.failed,
        finishedAt: now,
      },
    });

    const activeRun = await tx.analysisRun.findFirst({
      where: {
        tenantId: tenant.id,
        channelId: channel.id,
        dateRef,
        status: RunStatus.running,
      },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });

    if (activeRun?.id) {
      const error = new Error("Já existe uma execução em andamento para essa data e canal.");
      (error as Error & { code?: string }).code = "RUN_ALREADY_IN_PROGRESS";
      throw error;
    }

    const run = await tx.analysisRun.create({
      data: {
        tenantId: tenant.id,
        channelId: channel.id,
        dateRef,
        status: RunStatus.running,
        startedAt: now,
      },
      select: { id: true },
    });

    return run.id;
  }, { maxWait: 20_000, timeout: 120_000 });
}

export async function getCachedAnalysisByFingerprint(params: {
  config: AppConfig;
  account: { id: number; name: string | null };
  inbox: { id: number; name: string | null; provider: string | null };
  conversationIds: number[];
  sourceFingerprint: string;
}): Promise<{ answer: string } | null> {
  const fingerprint = String(params.sourceFingerprint || "").trim();
  const ids = (params.conversationIds || []).map((id) => Number(id || 0)).filter((id) => id > 0);
  if (!fingerprint || ids.length === 0) return null;

  const reportLike = {
    account: params.account,
    inbox: params.inbox,
  } as unknown as ReportPayload;
  const { tenant } = await resolveTenantAndChannel(prisma, params.config, reportLike);

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId: tenant.id,
      chatwootConversationId: { in: ids },
    },
    select: { id: true },
  });
  if (conversations.length === 0) return null;

  const conversationDbIds = conversations.map((item) => item.id);
  const cached = await prisma.analysisCache.findFirst({
    where: {
      tenantId: tenant.id,
      sourceFingerprint: fingerprint,
      conversationId: { in: conversationDbIds },
    },
    include: {
      analysis: {
        select: {
          aiRawJson: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const rawJson = cached?.analysis?.aiRawJson as Record<string, unknown> | null | undefined;
  if (!rawJson || typeof rawJson !== "object") return null;
  return {
    answer: JSON.stringify(rawJson, null, 2),
  };
}

export interface ConversationDeltaStateSnapshot {
  chatwootConversationId: number;
  lastAnalyzedMessageId: number | null;
  lastAnalyzedAt: string | null;
  lastMessageAt: string | null;
  lastMessageRole: string | null;
  stateSummary: string | null;
  lastDeltaHash: string | null;
  lastStatus: string | null;
  lastLabels: string[];
  lastFullAt: string | null;
  lastRunMode: string | null;
}

export async function getConversationDeltaStates(params: {
  config: AppConfig;
  account: { id: number; name: string | null };
  inbox: { id: number; name: string | null; provider: string | null };
  conversationIds: number[];
}): Promise<{
  tenantId: string;
  channelId: string;
  statesByConversationId: Map<number, ConversationDeltaStateSnapshot>;
}> {
  const reportLike = {
    account: params.account,
    inbox: params.inbox,
  } as unknown as ReportPayload;
  const { tenant, channel } = await resolveTenantAndChannel(prisma, params.config, reportLike);
  const ids = [...new Set((params.conversationIds || []).map((id) => Number(id || 0)).filter((id) => id > 0))];

  if (ids.length === 0) {
    return {
      tenantId: tenant.id,
      channelId: channel.id,
      statesByConversationId: new Map(),
    };
  }

  const rows = await prisma.conversationDeltaState.findMany({
    where: {
      tenantId: tenant.id,
      channelId: channel.id,
      chatwootConversationId: { in: ids },
    },
    select: {
      chatwootConversationId: true,
      lastAnalyzedMessageId: true,
      lastAnalyzedAt: true,
      lastMessageAt: true,
      lastMessageRole: true,
      stateSummary: true,
      lastDeltaHash: true,
      lastStatus: true,
      lastLabels: true,
      lastFullAt: true,
      lastRunMode: true,
    },
  });

  return {
    tenantId: tenant.id,
    channelId: channel.id,
    statesByConversationId: new Map(
      rows.map((row) => [
        Number(row.chatwootConversationId),
        {
          chatwootConversationId: Number(row.chatwootConversationId),
          lastAnalyzedMessageId: row.lastAnalyzedMessageId ?? null,
          lastAnalyzedAt: row.lastAnalyzedAt ? row.lastAnalyzedAt.toISOString() : null,
          lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
          lastMessageRole: row.lastMessageRole ?? null,
          stateSummary: row.stateSummary ?? null,
          lastDeltaHash: row.lastDeltaHash ?? null,
          lastStatus: row.lastStatus ?? null,
          lastLabels: Array.isArray(row.lastLabels) ? row.lastLabels : [],
          lastFullAt: row.lastFullAt ? row.lastFullAt.toISOString() : null,
          lastRunMode: row.lastRunMode ?? null,
        } satisfies ConversationDeltaStateSnapshot,
      ]),
    ),
  };
}

export async function upsertConversationDeltaStates(params: {
  tenantId: string;
  channelId: string;
  items: Array<{
    chatwootConversationId: number;
    lastAnalyzedMessageId: number | null;
    lastAnalyzedAt: string;
    lastMessageAt: string | null;
    lastMessageRole: string | null;
    stateSummary: string | null;
    lastDeltaHash: string | null;
    lastStatus: string | null;
    lastLabels: string[];
    lastFullAt?: string | null;
    lastRunMode?: string | null;
  }>;
}) {
  const rows = (params.items || [])
    .map((item) => ({
      ...item,
      chatwootConversationId: Number(item.chatwootConversationId || 0),
    }))
    .filter((item) => item.chatwootConversationId > 0);

  for (const item of rows) {
    await prisma.conversationDeltaState.upsert({
      where: {
        tenantId_channelId_chatwootConversationId: {
          tenantId: params.tenantId,
          channelId: params.channelId,
          chatwootConversationId: item.chatwootConversationId,
        },
      },
      update: {
        lastAnalyzedMessageId: item.lastAnalyzedMessageId,
        lastAnalyzedAt: item.lastAnalyzedAt ? new Date(item.lastAnalyzedAt) : null,
        lastMessageAt: item.lastMessageAt ? new Date(item.lastMessageAt) : null,
        lastMessageRole: item.lastMessageRole,
        stateSummary: item.stateSummary,
        lastDeltaHash: item.lastDeltaHash,
        lastStatus: item.lastStatus,
        lastLabels: item.lastLabels || [],
        lastFullAt: item.lastFullAt ? new Date(item.lastFullAt) : undefined,
        lastRunMode: item.lastRunMode || undefined,
      },
      create: {
        tenantId: params.tenantId,
        channelId: params.channelId,
        chatwootConversationId: item.chatwootConversationId,
        lastAnalyzedMessageId: item.lastAnalyzedMessageId,
        lastAnalyzedAt: item.lastAnalyzedAt ? new Date(item.lastAnalyzedAt) : null,
        lastMessageAt: item.lastMessageAt ? new Date(item.lastMessageAt) : null,
        lastMessageRole: item.lastMessageRole,
        stateSummary: item.stateSummary,
        lastDeltaHash: item.lastDeltaHash,
        lastStatus: item.lastStatus,
        lastLabels: item.lastLabels || [],
        lastFullAt: item.lastFullAt ? new Date(item.lastFullAt) : null,
        lastRunMode: item.lastRunMode || null,
      },
    });
  }
}

export async function getLatestConversationAnalysis(params: {
  config: AppConfig;
  account: { id: number; name: string | null };
  inbox: { id: number; name: string | null; provider: string | null };
  conversationIds: number[];
}): Promise<{ answer: string } | null> {
  const reportLike = {
    account: params.account,
    inbox: params.inbox,
  } as unknown as ReportPayload;
  const { tenant } = await resolveTenantAndChannel(prisma, params.config, reportLike);
  const ids = [...new Set((params.conversationIds || []).map((id) => Number(id || 0)).filter((id) => id > 0))];
  if (ids.length === 0) return null;

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId: tenant.id,
      chatwootConversationId: { in: ids },
    },
    select: { id: true },
  });
  if (!conversations.length) return null;

  const latest = await prisma.conversationAnalysis.findFirst({
    where: {
      conversationId: { in: conversations.map((conversation) => conversation.id) },
    },
    orderBy: { createdAt: "desc" },
    select: { aiRawJson: true },
  });

  const raw = latest?.aiRawJson as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== "object") return null;
  return { answer: JSON.stringify(raw, null, 2) };
}

export async function appendRunEvent(runId: string, eventType: string, payloadJson: unknown) {
  await prisma.jobEvent.create({
    data: {
      runId,
      eventType,
      payloadJson: (payloadJson as object) || {},
    },
  });
}

export async function updateRunProgress(
  runId: string,
  payload: { total?: number; processed?: number; successCount?: number; failureCount?: number },
) {
  await prisma.analysisRun.update({
    where: { id: runId },
    data: {
      totalConversations: Math.max(0, Number(payload.total || 0)),
      processed: Math.max(0, Number(payload.processed || 0)),
      successCount: Math.max(0, Number(payload.successCount || 0)),
      failureCount: Math.max(0, Number(payload.failureCount || 0)),
    },
  });
}

export async function persistCompletedRun(params: {
  runId: string;
  config: AppConfig;
  date: string;
  finishedAtIso: string;
  output: ReportPayload;
}) {
  const analyses = params.output.raw_analysis?.analyses || [];
  const failures = params.output.raw_analysis?.failures || [];
  const chatwootAppBase = toChatwootAppBase(params.config.chatwoot.baseUrl);
  const accountId = Number(params.output.account?.id || params.config.chatwoot.accountId || 0);
  const inboxId = Number(params.output.inbox?.id || params.config.chatwoot.inboxId || 0);
  const compactLogItems: Array<Record<string, unknown>> = [];
  const compactRawAnalyses: Array<Record<string, unknown>> = [];

  const pendingCacheWrites: Array<{
    tenantId: string;
    sourceFingerprint: string;
    analysisId: string;
    conversationDbIds: string[];
  }> = [];

  await prisma.$transaction(async (tx) => {
    const { tenant, channel } = await resolveTenantAndChannel(tx, params.config, params.output);

    await tx.analysisRun.update({
      where: { id: params.runId },
      data: {
        tenantId: tenant.id,
        channelId: channel.id,
        status: RunStatus.completed,
        finishedAt: new Date(params.finishedAtIso),
        totalConversations: Number(params.output.summary?.total_to_process || analyses.length),
        processed: Number(params.output.summary?.processed || analyses.length + failures.length),
        successCount: analyses.length,
        failureCount: failures.length,
      },
    });

    for (const analysis of analyses) {
      const parsed = parseJsonSafe(analysis.analysis?.answer);
      const contactIdentifier = String(analysis.contact?.identifier || '').trim();
      const contactName = toTitleCaseName(String(analysis.contact?.name || "").trim());
      const contact = await upsertContactByReference({
        db: tx,
        tenantId: tenant.id,
        contactKey: String(analysis.contact_key || ''),
        contactName,
        contactIdentifier,
      });

      let entryIdForCache: string | null = null;
      const firstConversationId = Number(analysis.conversation_ids?.[0] || 0);
      if (firstConversationId > 0) {
        const conversation = await tx.conversation.upsert({
          where: {
            tenantId_chatwootConversationId: {
              tenantId: tenant.id,
              chatwootConversationId: firstConversationId,
            },
          },
          update: {
            channelId: channel.id,
            contactId: contact.id,
          },
          create: {
            tenantId: tenant.id,
            channelId: channel.id,
            contactId: contact.id,
            chatwootConversationId: firstConversationId,
            labels: [],
          },
        });

        const existingAnalysis = await tx.conversationAnalysis.findFirst({
          where: {
            runId: params.runId,
            conversationId: conversation.id,
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

        const baseAnalysisUpdateData: Prisma.ConversationAnalysisUncheckedUpdateInput = {
          contactId: contact.id,
          riskLevel: Boolean(parsed.risco_critico) ? "critical" : "non_critical",
          summary: String(parsed.resumo || "").trim() || null,
          improvementsJson: asStringList(parsed.pontos_melhoria),
          nextStepsJson: asStringList(parsed.proximos_passos),
          aiRawJson: toJsonValue(parsed),
          finalizationStatus:
            analysis.conversation_operational?.[0]?.state?.finalization_status === "finalizada" ? "finalizada" : "continuada",
        };

        const baseAnalysisCreateData: Prisma.ConversationAnalysisUncheckedCreateInput = {
          runId: params.runId,
          conversationId: conversation.id,
          contactId: contact.id,
          riskLevel: Boolean(parsed.risco_critico) ? "critical" : "non_critical",
          summary: String(parsed.resumo || "").trim() || null,
          improvementsJson: asStringList(parsed.pontos_melhoria),
          nextStepsJson: asStringList(parsed.proximos_passos),
          aiRawJson: toJsonValue(parsed),
          finalizationStatus:
            analysis.conversation_operational?.[0]?.state?.finalization_status === "finalizada" ? "finalizada" : "continuada",
        };

        const entry = existingAnalysis
          ? await tx.conversationAnalysis.update({
              where: { id: existingAnalysis.id },
              data: baseAnalysisUpdateData,
            })
          : await tx.conversationAnalysis.create({
              data: baseAnalysisCreateData,
            });

        entryIdForCache = entry.id;

        if (existingAnalysis) {
          await tx.gap.deleteMany({ where: { analysisId: entry.id } });
          await tx.insight.deleteMany({ where: { analysisId: entry.id } });
        }

        const gaps = parseGapEntries(parsed);
        const gapRows = gaps.map((gap) => {
          const severityLabel = pickFirstText(gap, ["severidade", "severity", "nivel", "prioridade"]);
          const severity = parseGapSeverity(severityLabel);
          const isCritical = String(severityLabel).toLowerCase().startsWith("cr") || severity === GapSeverity.alta;
          return {
            analysisId: entry.id,
            name: pickFirstText(gap, ["nome_gap", "nome", "titulo", "title", "gap", "categoria"]) || "Gap operacional",
            severity,
            description: pickFirstText(gap, ["descricao", "description", "detalhe", "detalhes", "contexto"]) || null,
            messageReference:
              pickFirstText(gap, ["mensagem_referencia", "message_reference", "referencia_mensagem", "trecho"]) || null,
            userReportedData:
              pickFirstText(gap, ["dado_informado_pelo_usuario", "dado_informado", "valor_informado"]) || null,
            confirmedData:
              pickFirstText(gap, ["dado_confirmado_pelo_acesso_infinity", "dado_confirmado", "valor_confirmado"]) || null,
            category: pickFirstText(gap, ["categoria", "category"]) || null,
            isCritical,
          };
        });
        if (gapRows.length > 0) {
          await tx.gap.createMany({
            data: gapRows,
          });
        }

        const operationalInsights = allInsightsFromAnalysis(analysis);
        const insightRows = operationalInsights.map((insight) => ({
          analysisId: entry.id,
          type: insight.type || null,
          severity: parseInsightSeverity(insight.severity),
          title: String(insight.title || "Insight operacional"),
          summary: String(insight.summary || "").trim(),
          operationalStateJson: toJsonValue(insight),
        }));
        if (insightRows.length > 0) {
          await tx.insight.createMany({
            data: insightRows,
          });
        }
      }

      const links = (analysis.conversation_ids || [])
        .map((id) => buildConversationLink(chatwootAppBase, accountId, inboxId, Number(id)))
        .filter(Boolean);
      const firstState = asRecord(analysis.conversation_operational?.[0]?.state);
      const aggregatedLabels = Array.from(
        new Set(
          (analysis.conversation_operational || [])
            .flatMap((entry) => {
              const state = asRecord(entry?.state);
              return Array.isArray(state.labels) ? state.labels.map((label) => String(label || "").trim()) : [];
            })
            .filter(Boolean),
        ),
      );
      compactLogItems.push({
        contact_key: analysis.contact_key,
        contact_name: analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key,
        conversation_ids: analysis.conversation_ids || [],
        chatwoot_links: links,
        risk_level: Boolean(parsed.risco_critico) ? 'critical' : 'non_critical',
        summary: String(parsed.resumo || '').trim() || null,
        improvements: asStringList(parsed.pontos_melhoria),
        next_steps: asStringList(parsed.proximos_passos),
        finalization_status: analysis.conversation_operational?.[0]?.state?.finalization_status || null,
        finalization_actor: analysis.conversation_operational?.[0]?.state?.finalization_actor || null,
        message_count_day: analysis.message_count_day || 0,
        waiting_on_agent: asBool(firstState.waiting_on_agent),
        waiting_on_customer: asBool(firstState.waiting_on_customer),
        pending_since_at: asNumOrNull(firstState.pending_since_at),
        pending_since_at_local: firstState.pending_since_at_local ? String(firstState.pending_since_at_local) : null,
        last_interaction_at_local: firstState.last_interaction_at_local ? String(firstState.last_interaction_at_local) : null,
        trigger_after_1h_at_local: firstState.trigger_after_1h_at_local ? String(firstState.trigger_after_1h_at_local) : null,
        trigger_ready: asBool(firstState.trigger_ready),
        minutes_overdue: asNumOrNull(firstState.minutes_overdue),
        labels: aggregatedLabels.length > 0 ? aggregatedLabels : Array.isArray(firstState.labels) ? firstState.labels : [],
        created_at: params.finishedAtIso,
      });
      compactRawAnalyses.push({
        contact_key: analysis.contact_key,
        contact: analysis.contact,
        conversation_ids: analysis.conversation_ids || [],
        analysis_index: analysis.analysis_index || null,
        source_fingerprint: analysis.source_fingerprint || null,
        message_count_day: analysis.message_count_day || 0,
        log_text: analysis.log_text || "",
        conversation_operational: analysis.conversation_operational || [],
        analysis: {
          answer: analysis.analysis?.answer || null,
        },
      });

      const sourceFingerprint = String(analysis.source_fingerprint || "").trim();
      const cacheConversationIds = (analysis.conversation_ids || []).map((id) => Number(id || 0)).filter((id) => id > 0);
      if (sourceFingerprint && cacheConversationIds.length > 0 && entryIdForCache) {
        const cacheConversations = await tx.conversation.findMany({
          where: {
            tenantId: tenant.id,
            chatwootConversationId: { in: cacheConversationIds },
          },
          select: { id: true },
        });

        if (cacheConversations.length > 0) {
          pendingCacheWrites.push({
            tenantId: tenant.id,
            sourceFingerprint,
            analysisId: entryIdForCache,
            conversationDbIds: cacheConversations.map((item) => item.id),
          });
        }
      }
    }

    await tx.report.upsert({
      where: { runId: params.runId },
      update: {
        reportMarkdown: params.output.report_markdown,
        reportJson: toJsonValue({
          date: params.output.date,
          account: params.output.account,
          inbox: params.output.inbox,
          summary: params.output.summary,
          logs_count: compactLogItems.length,
          logs: compactLogItems,
          raw_analysis: {
            analyses: compactRawAnalyses,
            failures: params.output.raw_analysis?.failures || [],
            run_stats: params.output.raw_analysis?.run_stats || null,
          },
        }),
        generatedAt: new Date(params.finishedAtIso),
        version: 'v1',
      },
      create: {
        runId: params.runId,
        reportMarkdown: params.output.report_markdown,
        reportJson: toJsonValue({
          date: params.output.date,
          account: params.output.account,
          inbox: params.output.inbox,
          summary: params.output.summary,
          logs_count: compactLogItems.length,
          logs: compactLogItems,
          raw_analysis: {
            analyses: compactRawAnalyses,
            failures: params.output.raw_analysis?.failures || [],
            run_stats: params.output.raw_analysis?.run_stats || null,
          },
        }),
        generatedAt: new Date(params.finishedAtIso),
        version: 'v1',
      },
    });

    await tx.clientRecord.deleteMany({
      where: { runId: params.runId },
    });

    const clientRecords = buildClientRecordsFromAnalyses(compactRawAnalyses as unknown as ReportPayload["raw_analysis"]["analyses"]);
    if (clientRecords.length > 0) {
      await tx.clientRecord.createMany({
        data: clientRecords.map((record) => ({
          tenantId: tenant.id,
          channelId: channel.id,
          runId: params.runId,
          dateRef: toDateRef(params.date),
          phonePk: record.phonePk,
          contactName: record.contactName || null,
          companyName: record.companyName || null,
          cnpj: record.cnpj || null,
          gapsJson: toJsonValue(record.gaps),
          attentionsJson: toJsonValue(record.attentions),
          labels: record.labels,
          conversationIds: record.conversationIds,
          chatLinks:
            record.chatLinks.length > 0
              ? record.chatLinks
              : record.conversationIds
                  .map((conversationId) =>
                    buildConversationLink(chatwootAppBase, accountId, inboxId, Number(conversationId)),
                  )
                  .filter((link): link is string => Boolean(link)),
          openedAt: record.openedAt,
          closedAt: record.closedAt,
          status: record.status,
          severity: record.severity,
        })),
      });

      for (const record of clientRecords) {
        const existing = await tx.clientState.findUnique({
          where: {
            tenantId_channelId_phonePk: {
              tenantId: tenant.id,
              channelId: channel.id,
              phonePk: record.phonePk,
            },
          },
        });

        const effectiveOpenedAt = record.openedAt || new Date(params.finishedAtIso);
        const effectiveClosedAt = record.closedAt || new Date(params.finishedAtIso);
        const hasIssue = record.status === "atencao";
        const isResolved = record.status === "resolvido";
        const normalizedNextStatus = normalizeTimelineStatus(record.status);
        const movedOutOfAi = (record.labels || []).some((label) => {
          const key = String(label || "")
            .toLowerCase()
            .trim()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
          return key === "lead_agendado" || key === "pausar_ia";
        });

        if (!existing) {
          await tx.clientState.create({
            data: {
              tenantId: tenant.id,
              channelId: channel.id,
              phonePk: record.phonePk,
              contactName: record.contactName || null,
              companyName: record.companyName || null,
              cnpj: record.cnpj || null,
              firstSeenAt: effectiveOpenedAt,
              lastSeenAt: effectiveClosedAt,
              firstIssueAt: hasIssue ? effectiveOpenedAt : null,
              lastIssueAt: hasIssue ? effectiveClosedAt : null,
              resolvedAt: isResolved ? effectiveClosedAt : null,
              currentStatus: isResolved ? "resolvido" : hasIssue ? "atencao" : "aberto",
              currentSeverity: record.severity,
              currentLabels: record.labels,
              openConversationIds: isResolved ? [] : record.conversationIds,
              lastRunId: params.runId,
            },
          });

          await tx.conversationTimelineEvent.create({
            data: {
              tenantId: tenant.id,
              channelId: channel.id,
              dateRef: toDateRef(params.date),
              chatwootConversationId: Number(record.conversationIds?.[0] || 0),
              phonePk: record.phonePk,
              eventType: pickTimelineEventType({
                previousStatus: null,
                nextStatus: normalizedNextStatus,
                movedOutOfAi,
              }),
              severity: record.severity,
              reason:
                (record.gaps || [])[0] ||
                (record.attentions || [])[0] ||
                (movedOutOfAi ? "Conversa saiu do fluxo da IA por etiqueta operacional." : "Registro inicial da conversa."),
              source: "full",
            },
          });
          continue;
        }

        const selectedSeverity =
          insightSeverityRank[String(existing.currentSeverity || "info")] >
          insightSeverityRank[String(record.severity || "info")]
            ? existing.currentSeverity
            : record.severity;

        await tx.clientState.update({
          where: { id: existing.id },
          data: {
            contactName: record.contactName || existing.contactName,
            companyName: record.companyName || existing.companyName,
            cnpj: record.cnpj || existing.cnpj,
            firstSeenAt: existing.firstSeenAt < effectiveOpenedAt ? existing.firstSeenAt : effectiveOpenedAt,
            lastSeenAt: existing.lastSeenAt > effectiveClosedAt ? existing.lastSeenAt : effectiveClosedAt,
            firstIssueAt: hasIssue
              ? existing.firstIssueAt
                ? existing.firstIssueAt < effectiveOpenedAt
                  ? existing.firstIssueAt
                  : effectiveOpenedAt
                : effectiveOpenedAt
              : existing.firstIssueAt,
            lastIssueAt: hasIssue ? effectiveClosedAt : existing.lastIssueAt,
            resolvedAt: isResolved ? effectiveClosedAt : null,
            currentStatus: isResolved ? "resolvido" : hasIssue ? "atencao" : "aberto",
            currentSeverity: selectedSeverity,
            currentLabels: record.labels,
            openConversationIds: isResolved ? [] : record.conversationIds,
            lastRunId: params.runId,
          },
        });

        await tx.conversationTimelineEvent.create({
          data: {
            tenantId: tenant.id,
            channelId: channel.id,
            dateRef: toDateRef(params.date),
            chatwootConversationId: Number(record.conversationIds?.[0] || 0),
            phonePk: record.phonePk,
            eventType: pickTimelineEventType({
              previousStatus: normalizeTimelineStatus(existing.currentStatus),
              nextStatus: normalizedNextStatus,
              movedOutOfAi,
            }),
            severity: record.severity,
            reason:
              (record.gaps || [])[0] ||
              (record.attentions || [])[0] ||
              (movedOutOfAi
                ? "Conversa saiu do fluxo da IA por etiqueta operacional."
                : `Atualização operacional de status: ${existing.currentStatus} -> ${normalizedNextStatus}.`),
            source: "full",
          },
        });
      }
    }

    await tx.analysisRun.deleteMany({
      where: {
        id: { not: params.runId },
        tenantId: tenant.id,
        channelId: channel.id,
        dateRef: toDateRef(params.date),
        status: RunStatus.completed,
        report: {
          isNot: null,
        },
      },
    });
  }, { maxWait: 20_000, timeout: 180_000 });

  for (const cacheWrite of pendingCacheWrites) {
    try {
      await prisma.analysisCache.deleteMany({
        where: {
          tenantId: cacheWrite.tenantId,
          sourceFingerprint: cacheWrite.sourceFingerprint,
          conversationId: { in: cacheWrite.conversationDbIds },
        },
      });
      await prisma.analysisCache.createMany({
        data: cacheWrite.conversationDbIds.map((conversationId) => ({
          tenantId: cacheWrite.tenantId,
          conversationId,
          sourceFingerprint: cacheWrite.sourceFingerprint,
          analysisId: cacheWrite.analysisId,
        })),
      });
    } catch (error) {
      console.warn(
        `[audit-persistence] falha ao atualizar cache de análise (${cacheWrite.sourceFingerprint}):`,
        error,
      );
    }
  }
}

export async function markRunFailed(runId: string, finishedAtIso: string, message: string) {
  await prisma.analysisRun.update({
    where: { id: runId },
    data: {
      status: RunStatus.failed,
      finishedAt: new Date(finishedAtIso),
    },
  });
  await appendRunEvent(runId, "run_failed", { message });
}

export async function listRecentRuns(limit: number) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit || 10)));
  const rows = await prisma.analysisRun.findMany({
    where: {
      status: RunStatus.completed,
      report: {
        isNot: null,
      },
    },
    take: safeLimit,
    orderBy: { startedAt: "desc" },
    include: {
      report: true,
      channel: true,
      tenant: true,
    },
  });

  return rows
    .map((row) => {
      const reportJson = (row.report?.reportJson as Record<string, unknown> | null) || null;
      return {
        report_json: reportJson,
        id: row.id,
        status: row.status,
        date_ref: row.dateRef.toISOString().slice(0, 10),
        started_at: row.startedAt.toISOString(),
        finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
        total_conversations: row.totalConversations,
        processed: row.processed,
        success_count: row.successCount,
        failure_count: row.failureCount,
        tenant: row.tenant.name,
        channel: row.channel.name,
        has_report: hasRenderableReportData(reportJson),
      };
    })
    .filter((row) => row.has_report);
}

export async function getRunSnapshot(runId: string) {
  const run = await prisma.analysisRun.findUnique({
    where: { id: runId },
    include: {
      report: true,
    },
  });

  if (!run) return null;

  return {
    run: {
      id: run.id,
      status: run.status,
      date_ref: run.dateRef.toISOString().slice(0, 10),
      started_at: run.startedAt.toISOString(),
      finished_at: run.finishedAt ? run.finishedAt.toISOString() : null,
      total_conversations: run.totalConversations,
      processed: run.processed,
      success_count: run.successCount,
      failure_count: run.failureCount,
    },
    report_markdown: run.report?.reportMarkdown || null,
    report_json: (run.report?.reportJson as Record<string, unknown> | null) || null,
  };
}

export async function listAvailableReportDates(limit = 365) {
  const rows = await prisma.analysisRun.findMany({
    where: {
      status: RunStatus.completed,
      report: {
        isNot: null,
      },
    },
    orderBy: [{ dateRef: "desc" }, { startedAt: "desc" }],
    take: Math.max(1, Math.min(2000, Number(limit || 365))),
    select: {
      dateRef: true,
      report: {
        select: {
          reportJson: true,
        },
      },
    },
  });

  const validDates = new Set<string>();

  for (const row of rows) {
    const dateRef = row.dateRef.toISOString().slice(0, 10);
    if (validDates.has(dateRef)) continue;
    const reportJson = (row.report?.reportJson as Record<string, unknown> | null) || null;
    if (hasRenderableReportData(reportJson)) {
      validDates.add(dateRef);
    }
  }

  return Array.from(validDates);
}

export async function getLatestRunByDate(date: string) {
  const runs = await prisma.analysisRun.findMany({
    where: {
      dateRef: toDateRef(date),
      status: RunStatus.completed,
      report: {
        isNot: null,
      },
    },
    orderBy: { startedAt: "desc" },
    take: 10,
    include: {
      report: true,
      channel: true,
      tenant: true,
    },
  });

  const run = runs.find((item) => {
    const reportJson = (item.report?.reportJson as Record<string, unknown> | null) || null;
    return hasRenderableReportData(reportJson);
  });

  if (!run) return null;

  return {
    id: run.id,
    status: run.status,
    date_ref: run.dateRef.toISOString().slice(0, 10),
    started_at: run.startedAt.toISOString(),
    finished_at: run.finishedAt ? run.finishedAt.toISOString() : null,
    total_conversations: run.totalConversations,
    processed: run.processed,
    success_count: run.successCount,
    failure_count: run.failureCount,
    tenant: run.tenant.name,
    channel: run.channel.name,
    has_report: Boolean(run.report),
    report_json: (run.report?.reportJson as Record<string, unknown> | null) || null,
    report_markdown: run.report?.reportMarkdown || null,
  };
}

export async function getRunningRunByDate(date: string) {
  const run = await prisma.analysisRun.findFirst({
    where: {
      dateRef: toDateRef(date),
      status: RunStatus.running,
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      dateRef: true,
      startedAt: true,
      totalConversations: true,
      processed: true,
    },
  });

  if (!run) return null;

  return {
    id: run.id,
    date_ref: run.dateRef.toISOString().slice(0, 10),
    started_at: run.startedAt.toISOString(),
    total_conversations: run.totalConversations,
    processed: run.processed,
  };
}

export async function listClientsByDate(date: string) {
  const normalizeMatchKey = (value: string) =>
    String(value || "")
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const runsForDate = await prisma.analysisRun.findMany({
    where: {
      dateRef: toDateRef(date),
      status: RunStatus.completed,
      report: {
        isNot: null,
      },
    },
    orderBy: { startedAt: "desc" },
    take: 8,
    select: {
      id: true,
      tenantId: true,
      channelId: true,
      dateRef: true,
      startedAt: true,
      report: {
        select: {
          reportJson: true,
        },
      },
      channel: {
        select: {
          chatwootAccountId: true,
          chatwootInboxId: true,
        },
      },
      clientRecords: {
        orderBy: [{ status: "asc" }, { contactName: "asc" }],
        select: {
          phonePk: true,
          contactName: true,
          companyName: true,
          cnpj: true,
          gapsJson: true,
          attentionsJson: true,
          labels: true,
          conversationIds: true,
          chatLinks: true,
          openedAt: true,
          closedAt: true,
          status: true,
          severity: true,
        },
      },
    },
  });

  const runForDate =
    runsForDate.find((run) => {
      const reportJson = (run.report?.reportJson as Record<string, unknown> | null) || null;
      const hasReportPayload = hasRenderableReportData(reportJson);
      const hasClientSignals = (run.clientRecords || []).some((item) => {
        const hasGaps = Array.isArray(item.gapsJson) && item.gapsJson.length > 0;
        const hasAttentions = Array.isArray(item.attentionsJson) && item.attentionsJson.length > 0;
        const hasLinks = Array.isArray(item.chatLinks) && item.chatLinks.length > 0;
        return hasGaps || hasAttentions || hasLinks;
      });
      return hasReportPayload || hasClientSignals;
    }) ||
    runsForDate[0] ||
    null;

  const contextRun =
    runForDate ||
    (await prisma.analysisRun.findFirst({
      where: {
        status: RunStatus.completed,
        report: {
          isNot: null,
        },
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        channelId: true,
        dateRef: true,
        startedAt: true,
        channel: {
          select: {
            chatwootAccountId: true,
            chatwootInboxId: true,
          },
        },
      },
    }));

  if (!contextRun) {
    return {
      date,
      runId: null,
      generatedAt: null,
      source: "none",
      items: [],
    };
  }

  const states = await prisma.clientState.findMany({
    where: {
      tenantId: contextRun.tenantId,
      channelId: contextRun.channelId,
      phonePk: {
        in: (runForDate?.clientRecords || []).map((item) => item.phonePk),
      },
    },
    select: {
      phonePk: true,
      firstSeenAt: true,
      lastSeenAt: true,
      firstIssueAt: true,
      lastIssueAt: true,
      resolvedAt: true,
      currentStatus: true,
      currentSeverity: true,
    },
  });
  const stateByPhone = new Map(states.map((item) => [item.phonePk, item]));
  const phonesForTimeline = Array.from(new Set((runForDate?.clientRecords || []).map((item) => String(item.phonePk || "").trim()).filter(Boolean)));
  const timelineEvents = phonesForTimeline.length
    ? await prisma.conversationTimelineEvent.findMany({
        where: {
          tenantId: contextRun.tenantId,
          channelId: contextRun.channelId,
          phonePk: { in: phonesForTimeline },
        },
        orderBy: [{ createdAt: "asc" }],
        select: {
          phonePk: true,
          dateRef: true,
          chatwootConversationId: true,
          eventType: true,
          severity: true,
          reason: true,
          source: true,
          createdAt: true,
        },
      })
    : [];
  const timelineByPhone = new Map<string, Array<{
    dateRef: string;
    conversationId: number;
    eventType: string;
    severity: string;
    reason: string;
    source: string;
    createdAt: string;
  }>>();

  const normalizeSeverityText = (value: unknown): string => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "info";
    if (raw.includes("crit")) return "critical";
    if (raw.includes("high") || raw.includes("alt")) return "high";
    if (raw.includes("medium") || raw.includes("med")) return "medium";
    if (raw.includes("low") || raw.includes("baix")) return "low";
    if (raw === "non_critical") return "info";
    if (raw.includes("info")) return "info";
    return "info";
  };
  for (const event of timelineEvents) {
    const key = String(event.phonePk || "").trim();
    if (!key) continue;
    if (!timelineByPhone.has(key)) timelineByPhone.set(key, []);
    timelineByPhone.get(key)?.push({
      dateRef: event.dateRef.toISOString().slice(0, 10),
      conversationId: Number(event.chatwootConversationId || 0),
      eventType: String(event.eventType || ""),
      severity: String(event.severity || ""),
      reason: String(event.reason || ""),
      source: String(event.source || ""),
      createdAt: event.createdAt.toISOString(),
    });
  }

  const reportDrafts = (() => {
    const reportJson = (runForDate?.report?.reportJson as Record<string, unknown> | null) || null;
    const rawAnalysis = (reportJson?.raw_analysis || {}) as Record<string, unknown>;
    const analyses = Array.isArray(rawAnalysis.analyses) ? (rawAnalysis.analyses as ReportPayload["raw_analysis"]["analyses"]) : [];
    if (!analyses?.length) return [] as ReturnType<typeof buildClientRecordsFromAnalyses>;
    return buildClientRecordsFromAnalyses(analyses);
  })();

  const reportFallbackByPhone = new Map<
    string,
    {
      gaps: string[];
      attentions: string[];
      contactName: string;
      labels: string[];
      severity: string;
      status: string;
      conversationIds: number[];
      chatLinks: string[];
      openedAt: Date | null;
      closedAt: Date | null;
    }
  >();
  const reportFallbackByName = new Map<
    string,
    {
      gaps: string[];
      attentions: string[];
      contactName: string;
      labels: string[];
      severity: string;
      status: string;
      conversationIds: number[];
      chatLinks: string[];
      openedAt: Date | null;
      closedAt: Date | null;
    }
  >();

  const reportLogs = (() => {
    const reportJson = (runForDate?.report?.reportJson as Record<string, unknown> | null) || null;
    return Array.isArray(reportJson?.logs) ? (reportJson.logs as Array<Record<string, unknown>>) : [];
  })();

  const reportLogFallbackByName = new Map<
    string,
    {
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      conversationIds: number[];
      chatLinks: string[];
    }
  >();

  for (const draft of reportDrafts) {
    const payload = {
      gaps: Array.isArray(draft.gaps) ? draft.gaps : [],
      attentions: Array.isArray(draft.attentions) ? draft.attentions : [],
      contactName: toTitleCaseName(draft.contactName || ""),
      labels: Array.isArray(draft.labels) ? draft.labels : [],
      severity: draft.severity || "info",
      status: draft.status || "aberto",
      conversationIds: Array.isArray(draft.conversationIds) ? draft.conversationIds : [],
      chatLinks: Array.isArray(draft.chatLinks) ? draft.chatLinks : [],
      openedAt: draft.openedAt || null,
      closedAt: draft.closedAt || null,
    };

    const byPhoneKey = String(draft.phonePk || "").trim();
    if (byPhoneKey) reportFallbackByPhone.set(byPhoneKey, payload);
    const byNameKey = normalizeMatchKey(payload.contactName);
    if (byNameKey) reportFallbackByName.set(byNameKey, payload);
  }

  for (const log of reportLogs) {
    const name = toTitleCaseName(String(log.contact_name || "").trim());
    const nameKey = normalizeMatchKey(name);
    if (!nameKey) continue;

    const severity = normalizeSeverityText(log.risk_level);
    const summary = String(log.summary || "").trim();
    const improvements = Array.isArray(log.improvements)
      ? log.improvements.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const conversationIds = Array.isArray(log.conversation_ids)
      ? log.conversation_ids.map((item) => Number(item || 0)).filter((id) => id > 0)
      : [];
    const chatLinks = Array.isArray(log.chatwoot_links)
      ? log.chatwoot_links.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const gaps = summary && severity === "critical" ? [summary] : [];

    reportLogFallbackByName.set(nameKey, {
      gaps,
      attentions: improvements,
      labels: [],
      severity,
      status: severity === "critical" || severity === "high" ? "atencao" : "aberto",
      conversationIds,
      chatLinks,
    });
  }

  const analysisFallbackByConversationId = new Map<
    number,
    {
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      chatLinks: string[];
    }
  >();
  const analysisFallbackByName = new Map<
    string,
    {
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      chatLinks: string[];
    }
  >();
  const analysisFallbackByPhone = new Map<
    string,
    {
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      chatLinks: string[];
    }
  >();

  const severityPriority = (value: string): number => {
    const key = String(value || "info").toLowerCase();
    return insightSeverityRank[key] || 0;
  };

  const mergedSeverity = (current: string, incoming: string): string =>
    severityPriority(incoming) > severityPriority(current) ? incoming : current;

  const mergeStatus = (current: string, incoming: string): string => {
    const c = String(current || "").toLowerCase();
    const i = String(incoming || "").toLowerCase();
    if (c === "atencao" || i === "atencao") return "atencao";
    if (c === "aberto" || i === "aberto") return "aberto";
    if (c === "resolvido" || i === "resolvido") return "resolvido";
    return current || incoming || "aberto";
  };

  const mergeAnalysisPayload = (
    map: Map<
      string,
      {
        gaps: string[];
        attentions: string[];
        labels: string[];
        severity: string;
        status: string;
        chatLinks: string[];
      }
    >,
    key: string,
    payload: {
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      chatLinks: string[];
    },
  ) => {
    if (!key) return;
    const current = map.get(key);
    if (!current) {
      map.set(key, payload);
      return;
    }
    map.set(key, {
      gaps: Array.from(new Set([...current.gaps, ...payload.gaps])),
      attentions: Array.from(new Set([...current.attentions, ...payload.attentions])),
      labels: Array.from(new Set([...current.labels, ...payload.labels])),
      severity: mergedSeverity(current.severity, payload.severity),
      status: mergeStatus(current.status, payload.status),
      chatLinks: Array.from(new Set([...current.chatLinks, ...payload.chatLinks])),
    });
  };

  if (runForDate?.id) {
    const analysesFromTables = await prisma.conversationAnalysis.findMany({
      where: { runId: runForDate.id },
      select: {
        riskLevel: true,
        summary: true,
        finalizationStatus: true,
        improvementsJson: true,
        gaps: {
          select: {
            name: true,
            description: true,
            severity: true,
            isCritical: true,
          },
        },
        insights: {
          select: {
            title: true,
            summary: true,
            severity: true,
          },
        },
        conversation: {
          select: {
            chatwootConversationId: true,
            labels: true,
            resolvedAt: true,
            status: true,
          },
        },
        contact: {
          select: {
            name: true,
            identifierHash: true,
            identifierLast4: true,
            chatwootContactId: true,
          },
        },
      },
    });

    for (const analysis of analysesFromTables) {
      const conversationId = Number(analysis.conversation?.chatwootConversationId || 0);
      if (!conversationId) continue;

      const gaps = new Set<string>();
      const attentions = new Set<string>();
      const labels = new Set<string>(analysis.conversation?.labels || []);
      let severity = "info";
      let status = "aberto";

      if (analysis.finalizationStatus === "finalizada" || analysis.conversation?.resolvedAt || analysis.conversation?.status === "resolved") {
        status = "resolvido";
      }

      severity = normalizeSeverityText(analysis.riskLevel);

      const summary = String(analysis.summary || "").trim();
      if (summary && severity === "critical") gaps.add(summary);

      const improvements = Array.isArray(analysis.improvementsJson)
        ? analysis.improvementsJson.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      for (const item of improvements) attentions.add(item);

      for (const gap of analysis.gaps || []) {
        const text = String(gap.description || gap.name || "").trim();
        if (text) gaps.add(text);
        const gapSeverity = String(gap.severity || "").toLowerCase();
        if (gap.isCritical) {
          severity = "critical";
        } else if (gapSeverity === "alta" && severity !== "critical") {
          severity = "high";
        } else if (gapSeverity === "media" && severity !== "critical" && severity !== "high") {
          severity = "medium";
        } else if (gapSeverity === "baixa" && severity === "info") {
          severity = "low";
        }
      }

      for (const insight of analysis.insights || []) {
        const text = String(insight.summary || insight.title || "").trim();
        if (text) attentions.add(text);
        const insightSeverity = normalizeSeverityText(insight.severity);
        if (insightSeverity === "critical") {
          severity = "critical";
        } else if (insightSeverity === "high" && severity !== "critical") {
          severity = "high";
        } else if (
          insightSeverity === "medium" &&
          severity !== "critical" &&
          severity !== "high"
        ) {
          severity = "medium";
        } else if (insightSeverity === "low" && severity === "info") {
          severity = "low";
        }
      }

      const link = buildConversationLink(
        toChatwootAppBase("https://chat.iainfinity.com.br"),
        Number(contextRun.channel.chatwootAccountId || 0),
        Number(contextRun.channel.chatwootInboxId || 0),
        conversationId,
      );

      const payload = {
        gaps: Array.from(gaps),
        attentions: Array.from(attentions),
        labels: Array.from(labels),
        severity,
        status,
        chatLinks: link ? [link] : [],
      };

      analysisFallbackByConversationId.set(conversationId, payload);

      const nameKey = normalizeMatchKey(String(analysis.contact?.name || "").trim());
      mergeAnalysisPayload(analysisFallbackByName, nameKey, payload);

      const identifierRaw = String(analysis.contact?.identifierHash || "").trim();
      const digits = identifierRaw.replace(/\D+/g, "");
      const phonePk =
        digits.length >= 10
          ? digits
          : analysis.contact?.identifierLast4
            ? `contato-${analysis.contact.chatwootContactId || "sem-id"}-${analysis.contact.identifierLast4}`
            : "";
      if (phonePk) {
        mergeAnalysisPayload(analysisFallbackByPhone, phonePk, payload);
      }
    }
  }

  const recordsFromRun = (runForDate?.clientRecords || []).map((item) => {
    const fallback =
      reportFallbackByPhone.get(String(item.phonePk || "").trim()) ||
      reportFallbackByName.get(normalizeMatchKey(item.contactName || ""));
    const analysisFallbackByPhoneHit = analysisFallbackByPhone.get(String(item.phonePk || "").trim());
    const analysisFallbackByNameHit = analysisFallbackByName.get(
      normalizeMatchKey(String(item.contactName || fallback?.contactName || "")),
    );
    const logFallback = reportLogFallbackByName.get(
      normalizeMatchKey(String(item.contactName || fallback?.contactName || "")),
    );
    const gapsFromRecord = Array.isArray(item.gapsJson)
      ? item.gapsJson.map((gap) => String(gap || "").trim()).filter(Boolean)
      : [];
    const attentionsFromRecord = Array.isArray(item.attentionsJson)
      ? item.attentionsJson.map((attention) => String(attention || "").trim()).filter(Boolean)
      : [];
    const labelsFromRecord = Array.isArray(item.labels) ? item.labels.filter(Boolean) : [];
    const conversationIdsFromRecord = Array.isArray(item.conversationIds) ? item.conversationIds.filter(Boolean) : [];
    const chatLinksFromRecord = Array.isArray(item.chatLinks) ? item.chatLinks.filter(Boolean) : [];
    const conversationFallbackRows = conversationIdsFromRecord
      .map((conversationId) => analysisFallbackByConversationId.get(Number(conversationId || 0)))
      .filter(Boolean) as Array<{
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      chatLinks: string[];
    }>;
    const conversationFallback = {
      gaps: Array.from(new Set(conversationFallbackRows.flatMap((row) => row.gaps))),
      attentions: Array.from(new Set(conversationFallbackRows.flatMap((row) => row.attentions))),
      labels: Array.from(new Set(conversationFallbackRows.flatMap((row) => row.labels))),
      severities: conversationFallbackRows.map((row) => row.severity),
      statuses: conversationFallbackRows.map((row) => row.status),
      chatLinks: Array.from(new Set(conversationFallbackRows.flatMap((row) => row.chatLinks))),
    };
    const unifiedSeverityCandidates = [
      item.severity,
      fallback?.severity,
      analysisFallbackByPhoneHit?.severity,
      analysisFallbackByNameHit?.severity,
      logFallback?.severity,
      ...conversationFallback.severities,
    ].filter(Boolean) as string[];
    const unifiedSeverity = unifiedSeverityCandidates.reduce(
      (best, current) => mergedSeverity(best, current),
      "info",
    ) as typeof item.severity;
    const unifiedStatusCandidates = [
      item.status,
      fallback?.status,
      analysisFallbackByPhoneHit?.status,
      analysisFallbackByNameHit?.status,
      logFallback?.status,
      ...conversationFallback.statuses,
    ].filter(Boolean) as string[];
    const unifiedStatus = unifiedStatusCandidates.reduce(
      (best, current) => mergeStatus(best, current),
      "aberto",
    );

    return {
    lifecycle: (() => {
      const state = stateByPhone.get(item.phonePk);
      if (!state) return null;
      return {
        firstSeenAt: state.firstSeenAt.toISOString(),
        lastSeenAt: state.lastSeenAt.toISOString(),
        firstIssueAt: state.firstIssueAt ? state.firstIssueAt.toISOString() : null,
        lastIssueAt: state.lastIssueAt ? state.lastIssueAt.toISOString() : null,
        resolvedAt: state.resolvedAt ? state.resolvedAt.toISOString() : null,
        currentStatus: state.currentStatus,
        currentSeverity: state.currentSeverity,
      };
    })(),
    timeline: timelineByPhone.get(item.phonePk) || [],
    phonePk: item.phonePk,
    contactName: toTitleCaseName(item.contactName || fallback?.contactName || ""),
    companyName: item.companyName || "",
    cnpj: item.cnpj || "",
    gaps:
      gapsFromRecord.length > 0
        ? gapsFromRecord
        : fallback?.gaps ||
          analysisFallbackByPhoneHit?.gaps ||
          analysisFallbackByNameHit?.gaps ||
          logFallback?.gaps ||
          conversationFallback.gaps ||
          [],
    attentions:
      attentionsFromRecord.length > 0
        ? attentionsFromRecord
        : fallback?.attentions ||
          analysisFallbackByPhoneHit?.attentions ||
          analysisFallbackByNameHit?.attentions ||
          logFallback?.attentions ||
          conversationFallback.attentions ||
          [],
    labels:
      labelsFromRecord.length > 0
        ? labelsFromRecord
        : fallback?.labels ||
          analysisFallbackByPhoneHit?.labels ||
          analysisFallbackByNameHit?.labels ||
          logFallback?.labels ||
          conversationFallback.labels ||
          [],
    conversationIds:
      conversationIdsFromRecord.length > 0
        ? conversationIdsFromRecord
        : fallback?.conversationIds || logFallback?.conversationIds || [],
    chatLinks:
      chatLinksFromRecord.length > 0
        ? chatLinksFromRecord
        : fallback?.chatLinks ||
          analysisFallbackByPhoneHit?.chatLinks ||
          analysisFallbackByNameHit?.chatLinks ||
          logFallback?.chatLinks ||
          conversationFallback.chatLinks ||
          [],
    openedAt: item.openedAt ? item.openedAt.toISOString() : null,
    closedAt: item.closedAt ? item.closedAt.toISOString() : null,
    status: unifiedStatus,
    severity: unifiedSeverity,
  };
  });

  if (recordsFromRun.length > 0) {
    return {
      date: runForDate?.dateRef.toISOString().slice(0, 10) || date,
      runId: runForDate?.id || null,
      generatedAt: runForDate?.startedAt.toISOString() || null,
      source: "client_records",
      items: recordsFromRun,
    };
  }

  if (reportDrafts.length > 0) {
    return {
      date: runForDate?.dateRef.toISOString().slice(0, 10) || date,
      runId: runForDate?.id || contextRun.id,
      generatedAt: runForDate?.startedAt.toISOString() || contextRun.startedAt.toISOString(),
      source: "report_fallback",
      items: reportDrafts.map((draft) => {
        const state = stateByPhone.get(draft.phonePk);
        return {
          lifecycle: state
            ? {
                firstSeenAt: state.firstSeenAt.toISOString(),
                lastSeenAt: state.lastSeenAt.toISOString(),
                firstIssueAt: state.firstIssueAt ? state.firstIssueAt.toISOString() : null,
                lastIssueAt: state.lastIssueAt ? state.lastIssueAt.toISOString() : null,
                resolvedAt: state.resolvedAt ? state.resolvedAt.toISOString() : null,
                currentStatus: state.currentStatus,
                currentSeverity: state.currentSeverity,
              }
            : null,
          timeline: timelineByPhone.get(draft.phonePk) || [],
          phonePk: draft.phonePk,
          contactName: toTitleCaseName(draft.contactName || ""),
          companyName: draft.companyName || "",
          cnpj: draft.cnpj || "",
          gaps: draft.gaps || [],
          attentions: draft.attentions || [],
          labels: draft.labels || [],
          conversationIds: draft.conversationIds || [],
          chatLinks: draft.chatLinks || [],
          openedAt: draft.openedAt ? draft.openedAt.toISOString() : null,
          closedAt: draft.closedAt ? draft.closedAt.toISOString() : null,
          status: draft.status || "aberto",
          severity: draft.severity || "info",
        };
      }),
    };
  }

  const statesFallback = await prisma.clientState.findMany({
    where: {
      tenantId: contextRun.tenantId,
      channelId: contextRun.channelId,
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  if (statesFallback.length > 0) {
    return {
      date: runForDate?.dateRef.toISOString().slice(0, 10) || date,
      runId: runForDate?.id || contextRun.id,
      generatedAt: runForDate?.startedAt.toISOString() || contextRun.startedAt.toISOString(),
      source: "client_states",
      items: statesFallback.map((state) => ({
        lifecycle: {
          firstSeenAt: state.firstSeenAt.toISOString(),
          lastSeenAt: state.lastSeenAt.toISOString(),
          firstIssueAt: state.firstIssueAt ? state.firstIssueAt.toISOString() : null,
          lastIssueAt: state.lastIssueAt ? state.lastIssueAt.toISOString() : null,
          resolvedAt: state.resolvedAt ? state.resolvedAt.toISOString() : null,
          currentStatus: state.currentStatus,
          currentSeverity: state.currentSeverity,
        },
        timeline: timelineByPhone.get(state.phonePk) || [],
        phonePk: state.phonePk,
        contactName: toTitleCaseName(state.contactName || ""),
        companyName: state.companyName || "",
        cnpj: state.cnpj || "",
        gaps: [],
        attentions: [],
        labels: state.currentLabels || [],
        conversationIds: state.openConversationIds || [],
        chatLinks: (state.openConversationIds || [])
          .map((conversationId) =>
            buildConversationLink(
              toChatwootAppBase("https://chat.iainfinity.com.br"),
              Number(contextRun.channel.chatwootAccountId || 0),
              Number(contextRun.channel.chatwootInboxId || 0),
              Number(conversationId || 0),
            ),
          )
          .filter((link): link is string => Boolean(link)),
        openedAt: state.firstSeenAt ? state.firstSeenAt.toISOString() : null,
        closedAt: state.resolvedAt ? state.resolvedAt.toISOString() : null,
        status: state.currentStatus,
        severity: state.currentSeverity,
      })),
    };
  }

  const contacts = await prisma.contact.findMany({
    where: {
      tenantId: contextRun.tenantId,
      conversations: {
        some: {
          channelId: contextRun.channelId,
        },
      },
    },
    select: {
      name: true,
      chatwootContactId: true,
      identifierHash: true,
      identifierLast4: true,
      conversations: {
        where: {
          channelId: contextRun.channelId,
        },
        select: {
          chatwootConversationId: true,
          labels: true,
          createdAt: true,
          resolvedAt: true,
          lastActivityAt: true,
          status: true,
        },
      },
    },
    take: 500,
    orderBy: { updatedAt: "desc" },
  });

  const contactItems = contacts.map((contact) => {
    const identifierRaw = String(contact.identifierHash || "").trim();
    const digits = identifierRaw.replace(/\D+/g, "");
    const phonePk =
      digits.length >= 10
        ? digits
        : contact.identifierLast4
          ? `contato-${contact.chatwootContactId || "sem-id"}-${contact.identifierLast4}`
          : `contato-${contact.chatwootContactId || "sem-id"}`;

    const conversationIds = contact.conversations
      .map((conversation) => Number(conversation.chatwootConversationId || 0))
      .filter((id) => id > 0);
    const labels = Array.from(new Set(contact.conversations.flatMap((conversation) => conversation.labels || []).filter(Boolean)));
    const createdDates = contact.conversations.map((conversation) => conversation.createdAt).filter(Boolean);
    const resolvedDates = contact.conversations.map((conversation) => conversation.resolvedAt).filter(Boolean);
    const openedAt = createdDates.length > 0 ? new Date(Math.min(...createdDates.map((item) => item.getTime()))) : null;
    const closedAt = resolvedDates.length > 0 ? new Date(Math.max(...resolvedDates.map((item) => item.getTime()))) : null;
    const status = closedAt ? "resolvido" : "aberto";

    return {
      lifecycle: null,
      timeline: timelineByPhone.get(phonePk) || [],
      phonePk,
      contactName: toTitleCaseName(String(contact.name || "").trim()),
      companyName: "",
      cnpj: "",
      gaps: [],
      attentions: [],
      labels,
      conversationIds,
      chatLinks: conversationIds
        .map((conversationId) =>
          buildConversationLink(
            toChatwootAppBase("https://chat.iainfinity.com.br"),
            Number(contextRun.channel.chatwootAccountId || 0),
            Number(contextRun.channel.chatwootInboxId || 0),
            Number(conversationId || 0),
          ),
        )
        .filter((link): link is string => Boolean(link)),
      openedAt: openedAt ? openedAt.toISOString() : null,
      closedAt: closedAt ? closedAt.toISOString() : null,
      status,
      severity: "info",
    };
  });

  return {
    date: runForDate?.dateRef.toISOString().slice(0, 10) || date,
    runId: runForDate?.id || contextRun.id,
    generatedAt: runForDate?.startedAt.toISOString() || contextRun.startedAt.toISOString(),
    source: "contacts_fallback",
    items: contactItems,
  };
}



