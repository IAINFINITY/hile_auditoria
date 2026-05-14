import { GapSeverity, InsightSeverity, Prisma, RunStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { AppConfig } from "./types";
import type { ReportPayload } from "@/types";

function normalizeSlug(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function toDateRef(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toChatwootAppBase(baseUrl: string): string {
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

function buildConversationLink(baseUrl: string, accountId: number, inboxId: number, conversationId: number): string | null {
  if (!baseUrl || !accountId || !inboxId || !conversationId) return null;
  return `${baseUrl}/app/accounts/${accountId}/inbox/${inboxId}/conversations/${conversationId}`;
}

function parseGapSeverity(value: unknown): GapSeverity {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.startsWith("alt")) return GapSeverity.alta;
  if (raw.startsWith("med")) return GapSeverity.media;
  if (raw.startsWith("baix")) return GapSeverity.baixa;
  return GapSeverity.nao_informado;
}

function parseInsightSeverity(value: unknown): InsightSeverity {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "critical") return InsightSeverity.critical;
  if (raw === "high") return InsightSeverity.high;
  if (raw === "medium") return InsightSeverity.medium;
  if (raw === "low") return InsightSeverity.low;
  return InsightSeverity.info;
}

function parseJsonSafe(text: unknown): Record<string, unknown> {
  const raw = String(text || "").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const fencedMatch = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    if (!fencedMatch) return {};
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
      return {};
    }
  }
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function parseGapEntries(parsed: Record<string, unknown>): Array<Record<string, unknown>> {
  const items = parsed.gaps_operacionais;
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
}

function pickFirstText(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function asBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1" || text === "sim") return true;
  if (text === "false" || text === "0" || text === "nao" || text === "não") return false;
  return null;
}

function asNumOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function resolveTenantAndChannel(config: AppConfig, report: ReportPayload) {
  const accountId = Number(report.account?.id || config.chatwoot.accountId || 0);
  const inboxId = Number(report.inbox?.id || config.chatwoot.inboxId || 0);
  const groupName = String(report.account?.name || config.chatwoot.groupName || "Tenant");
  const inboxName = String(report.inbox?.name || config.chatwoot.inboxName || "Inbox");
  const slugBase = normalizeSlug(`${groupName}-${accountId || "na"}`) || "tenant";

  const tenant = await prisma.tenant.upsert({
    where: { slug: slugBase },
    update: { name: groupName },
    create: { slug: slugBase, name: groupName },
  });

  const channel = await prisma.channel.upsert({
    where: {
      tenantId_chatwootAccountId_chatwootInboxId: {
        tenantId: tenant.id,
        chatwootAccountId: accountId,
        chatwootInboxId: inboxId,
      },
    },
    update: {
      name: inboxName,
      provider: report.inbox?.provider || config.chatwoot.inboxProvider || null,
    },
    create: {
      tenantId: tenant.id,
      chatwootAccountId: accountId,
      chatwootInboxId: inboxId,
      name: inboxName,
      provider: report.inbox?.provider || config.chatwoot.inboxProvider || null,
    },
  });

  return { tenant, channel };
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
  const { tenant, channel } = await resolveTenantAndChannel(params.config, baseReportLike);

  const run = await prisma.analysisRun.create({
    data: {
      tenantId: tenant.id,
      channelId: channel.id,
      dateRef: toDateRef(params.date),
      status: RunStatus.running,
      startedAt: new Date(params.startedAtIso),
    },
  });

  return run.id;
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
  const { tenant, channel } = await resolveTenantAndChannel(params.config, params.output);
  const analyses = params.output.raw_analysis?.analyses || [];
  const failures = params.output.raw_analysis?.failures || [];
  const chatwootAppBase = toChatwootAppBase(params.config.chatwoot.baseUrl);
  const accountId = Number(params.output.account?.id || params.config.chatwoot.accountId || 0);
  const inboxId = Number(params.output.inbox?.id || params.config.chatwoot.inboxId || 0);
  const compactLogItems: Array<Record<string, unknown>> = [];
  const compactRawAnalyses: Array<Record<string, unknown>> = [];

  await prisma.analysisRun.update({
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
    const contactIdentifier = String(analysis.contact?.identifier || "").trim();
    const contactName = String(analysis.contact?.name || "").trim();
    const contact = await prisma.contact.create({
      data: {
        tenantId: tenant.id,
        chatwootContactId: Number.isFinite(Number(analysis.contact_key)) ? Number(analysis.contact_key) : null,
        name: contactName || null,
        identifierHash: contactIdentifier || null,
        identifierLast4: contactIdentifier ? contactIdentifier.slice(-4) : null,
      },
    });

    const firstConversationId = Number(analysis.conversation_ids?.[0] || 0);
    const conversation = await prisma.conversation.upsert({
      where: {
        tenantId_chatwootConversationId: {
          tenantId: tenant.id,
          chatwootConversationId: firstConversationId || Number(analysis.analysis_index || 0),
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
        chatwootConversationId: firstConversationId || Number(analysis.analysis_index || 0),
        labels: [],
      },
    });

    const entry = await prisma.conversationAnalysis.create({
      data: {
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
      },
    });

    const gaps = parseGapEntries(parsed);
    for (const gap of gaps) {
      const severityLabel = pickFirstText(gap, ["severidade", "severity", "nivel", "prioridade"]);
      const severity = parseGapSeverity(severityLabel);
      const isCritical = String(severityLabel).toLowerCase().startsWith("cr") || severity === GapSeverity.alta;
      await prisma.gap.create({
        data: {
          analysisId: entry.id,
          name:
            pickFirstText(gap, ["nome_gap", "nome", "titulo", "title", "gap", "categoria"]) ||
            "Gap operacional",
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
        },
      });
    }

    const operationalInsights = allInsightsFromAnalysis(analysis);
    for (const insight of operationalInsights) {
      await prisma.insight.create({
        data: {
          analysisId: entry.id,
          type: insight.type || null,
          severity: parseInsightSeverity(insight.severity),
          title: String(insight.title || "Insight operacional"),
          summary: String(insight.summary || "").trim(),
          operationalStateJson: insight,
        },
      });
    }

    const links = (analysis.conversation_ids || [])
      .map((id) => buildConversationLink(chatwootAppBase, accountId, inboxId, Number(id)))
      .filter(Boolean);
    const firstState = asRecord(analysis.conversation_operational?.[0]?.state);
    compactLogItems.push({
      contact_key: analysis.contact_key,
      contact_name: analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key,
      conversation_ids: analysis.conversation_ids || [],
      chatwoot_links: links,
      risk_level: Boolean(parsed.risco_critico) ? "critical" : "non_critical",
      summary: String(parsed.resumo || "").trim() || null,
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
      labels: Array.isArray(firstState.labels) ? firstState.labels : [],
      created_at: params.finishedAtIso,
    });
    compactRawAnalyses.push({
      contact_key: analysis.contact_key,
      contact: analysis.contact,
      conversation_ids: analysis.conversation_ids || [],
      analysis_index: analysis.analysis_index || null,
      message_count_day: analysis.message_count_day || 0,
      conversation_operational: analysis.conversation_operational || [],
      analysis: {
        answer: analysis.analysis?.answer || null,
      },
    });
  }

  await prisma.report.upsert({
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
      version: "v1",
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
      version: "v1",
    },
  });

  // Mantemos apenas a execução mais recente por dia/canal para "substituir" o relatório antigo.
  await prisma.analysisRun.deleteMany({
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
}

function allInsightsFromAnalysis(analysis: ReportPayload["raw_analysis"]["analyses"][number]) {
  const items = analysis.conversation_operational || [];
  return items
    .map((item) => item.state)
    .filter(Boolean)
    .map((state) => {
      if (state?.finalization_status === "finalizada") {
        return {
          type: "finalization",
          severity: "low",
          title: "Conversa finalizada",
          summary: state.finalization_actor
            ? `Finalizada por ${state.finalization_actor}.`
            : "Conversa encerrada com status de finalização.",
          state,
        };
      }
      if (state?.waiting_on_agent) {
        return {
          type: "pending_agent",
          severity: "medium",
          title: "Aguardando resposta do atendimento",
          summary: "Cliente aguardando resposta.",
          state,
        };
      }
      return {
        type: "pending_customer",
        severity: "info",
        title: "Aguardando retorno do cliente",
        summary: "Última interação foi enviada pela IA/atendente.",
        state,
      };
    });
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

  return rows.map((row) => ({
    report_json: row.report?.reportJson || null,
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
    has_report: Boolean(row.report),
  }));
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
    orderBy: { dateRef: "desc" },
    distinct: ["dateRef"],
    take: Math.max(1, Math.min(2000, Number(limit || 365))),
    select: {
      dateRef: true,
    },
  });

  return rows.map((row) => row.dateRef.toISOString().slice(0, 10));
}

export async function getLatestRunByDate(date: string) {
  const run = await prisma.analysisRun.findFirst({
    where: {
      dateRef: toDateRef(date),
      status: RunStatus.completed,
      report: {
        isNot: null,
      },
    },
    orderBy: { startedAt: "desc" },
    include: {
      report: true,
      channel: true,
      tenant: true,
    },
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
