import { GapSeverity, Prisma, RunStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { AppConfig } from "./types";
import type { ReportPayload } from "@/types";
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
      const contactName = String(analysis.contact?.name || '').trim();
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



