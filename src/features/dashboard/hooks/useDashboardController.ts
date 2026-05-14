import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
import type {
  AnalysisItem,
  AvailableDatesResponse,
  FailureItem,
  InsightItem,
  OverviewPayload,
  PreviewPayload,
  ReportByDateResponse,
  ReportHistoryResponse,
  ReportJobStartResponse,
  ReportJobStatusResponse,
  ReportPayload,
  ReportRunResponse,
  Severity,
  SystemCheckResponse,
} from "../../../types";
import { INSIGHTS_COLLAPSED_LIMIT, severityOrder } from "../shared/constants";
import { clampDateInput, normalizeDateInput, parseHour, toDateInputValue } from "../shared/helpers";
import type {
  ActionKey,
  ApiConfigPayload,
  DashboardController,
  InsightFilter,
  MetricCard,
  PeriodPreset,
  ReportLinkItem,
  RiskRow,
  SeveritySnapshot,
} from "../shared/types";

type ReportSeverityFilter = "all" | "critical" | "high" | "medium" | "low" | "info";

function normalizeTextForMatch(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function inferSeverityFromValue(value: unknown, fallback: Severity = "info"): Severity {
  const text = normalizeTextForMatch(value);
  if (!text) return fallback;
  if (text.includes("crit")) return "critical";
  if (text.includes("alt")) return "high";
  if (text.includes("med")) return "medium";
  if (text.includes("baix")) return "low";
  if (text.includes("info")) return "info";
  return fallback;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function buildStructuredReportMarkdown(
  report: ReportPayload | null,
  selectedContact: string | null,
  severityFilter: ReportSeverityFilter,
): string {
  if (!report?.raw_analysis?.analyses?.length) return "";
  const analyses = report.raw_analysis.analyses;
  const filteredSections: string[] = [];
  const contactNeedle = normalizeTextForMatch(selectedContact);

  analyses.forEach((analysis, index) => {
    const parsed = parseJsonObject(analysis.analysis?.answer);
    const contactName = String(analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || `Contato ${index + 1}`);
    const conversationIds = Array.isArray(analysis.conversation_ids) ? analysis.conversation_ids.map((id) => Number(id)).filter((id) => id > 0) : [];
    const resumo = String(parsed.resumo || "Sem resumo estruturado.");
    const melhorias = toStringList(parsed.pontos_melhoria);
    const proximosPassos = toStringList(parsed.proximos_passos);
    const isCriticalRisk = Boolean(parsed.risco_critico);
    const analysisSeverity = inferSeverityFromValue(
      parsed.severidade || parsed.severity || parsed.nivel_risco || parsed.risco,
      isCriticalRisk ? "critical" : "info",
    );

    const gaps = Array.isArray(parsed.gaps_operacionais) ? parsed.gaps_operacionais : [];
    const gapSeverities = gaps
      .map((gap) => asRecord(gap))
      .map((gap) => inferSeverityFromValue(gap.severidade || gap.severity || gap.nivel || gap.prioridade, analysisSeverity));

    const shouldIncludeBySeverity =
      severityFilter === "all" ||
      analysisSeverity === severityFilter ||
      gapSeverities.includes(severityFilter as Severity);

    const shouldIncludeByContact =
      !contactNeedle || normalizeTextForMatch(contactName).includes(contactNeedle);

    if (!shouldIncludeBySeverity || !shouldIncludeByContact) return;

    const gapLines = gaps
      .map((gap) => asRecord(gap))
      .map((gap, gapIndex) => {
        const nome = String(gap.nome_gap || gap.nome || gap.titulo || gap.title || "Gap operacional");
        const severidade = inferSeverityFromValue(
          gap.severidade || gap.severity || gap.nivel || gap.prioridade,
          analysisSeverity,
        );
        const descricao = String(gap.descricao || gap.description || gap.detalhe || gap.contexto || "").trim();
        const reference = String(gap.mensagem_referencia || gap.message_reference || gap.referencia_mensagem || "").trim();
        const ptSeverity =
          severidade === "critical"
            ? "Crítico"
            : severidade === "high"
              ? "Alto"
              : severidade === "medium"
                ? "Médio"
                : severidade === "low"
                  ? "Baixo"
                  : "Informativo";
        return `- Gap ${gapIndex + 1}: ${nome} (${ptSeverity})${descricao ? ` - ${descricao}` : ""}${reference ? ` | Ref: ${reference}` : ""}`;
      });

    const lines: string[] = [
      `### ${index + 1}. ${contactName}`,
      `- Contact key: \`${analysis.contact_key}\``,
      `- Conversas: ${conversationIds.length > 0 ? conversationIds.join(", ") : "não informado"}`,
      `- Severidade principal: ${
        analysisSeverity === "critical"
          ? "Crítico"
          : analysisSeverity === "high"
            ? "Alto"
            : analysisSeverity === "medium"
              ? "Médio"
              : analysisSeverity === "low"
                ? "Baixo"
                : "Informativo"
      }`,
      `- Risco crítico: ${isCriticalRisk ? "Sim" : "Não"}`,
      `- Resumo: ${resumo}`,
      `- Pontos de melhoria: ${melhorias.length > 0 ? melhorias.join(" | ") : "Nenhum ponto informado."}`,
      `- Próximos passos: ${proximosPassos.length > 0 ? proximosPassos.join(" | ") : "Nenhum próximo passo informado."}`,
      `- Gaps operacionais identificados: ${gapLines.length}`,
      ...gapLines,
    ];

    filteredSections.push(lines.join("\n"));
  });

  if (filteredSections.length === 0) {
    const contactPart = selectedContact ? `contato "${selectedContact}"` : "contato";
    const severityPart = severityFilter !== "all" ? ` e severidade "${severityFilter}"` : "";
    return `Nenhum trecho estruturado foi encontrado para ${contactPart}${severityPart}.`;
  }

  const header = [
    "# Relatório Diário - Auditoria de Atendimento",
    "",
    `- Data: ${report.date}`,
    `- Conta: ${report.account?.name || "N/A"} (id ${report.account?.id || "N/A"})`,
    `- Canal: ${report.inbox?.name || "N/A"} (id ${report.inbox?.id || "N/A"})`,
    "",
    "## Detalhamento por Contato",
    "",
  ];

  return [...header, filteredSections.join("\n\n")].join("\n");
}

function toChatwootAppBase(baseUrl: string): string {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "").replace(/\/api\/v1(?:\/.*)?$/i, "").replace(/\/api(?:\/.*)?$/i, "");
}

function buildConversationLink(baseUrl: string, accountId: number, inboxId: number, conversationId: number): string | null {
  if (!baseUrl || !accountId || !inboxId || !conversationId) return null;
  return `${baseUrl}/app/accounts/${accountId}/inbox/${inboxId}/conversations/${conversationId}`;
}

function addDays(baseDate: Date, days: number): Date {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "1" || text === "sim";
}

function parseJsonObject(text: unknown): Record<string, unknown> {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

function mapRunToDashboardSnapshot(run: ReportByDateResponse["run"]): {
  overview: OverviewPayload;
  insights: InsightItem[];
  report: ReportPayload;
  rawOutput: string;
} {
  const reportJson = asRecord(run.report_json);
  const summary = asRecord(reportJson.summary);
  const account = asRecord(reportJson.account);
  const inbox = asRecord(reportJson.inbox);
  const rawAnalysis = asRecord(reportJson.raw_analysis);
  const rawAnalyses = Array.isArray(rawAnalysis.analyses) ? rawAnalysis.analyses.map(asRecord) : [];

  const operationalByConversation = new Map<number, Record<string, unknown>>();
  const operationalRows: OverviewPayload["conversation_operational"] = [];

  for (const item of rawAnalyses) {
    const contact = asRecord(item.contact);
    const contactName = asString(contact.name || contact.identifier || item.contact_key);
    const contactIdentifier = asString(contact.identifier || "");
    const contactKey = asString(item.contact_key || contactIdentifier || contactName || "contato");
    const messageCountDay = asNumber(item.message_count_day, 0);
    const ops = Array.isArray(item.conversation_operational) ? item.conversation_operational.map(asRecord) : [];
    for (const op of ops) {
      const state = asRecord(op.state);
      const conversationId = asNumber(op.conversation_id, 0);
      if (!conversationId) continue;

      operationalByConversation.set(conversationId, state);
      operationalRows.push({
        conversation_id: conversationId,
        contact_key: contactKey,
        finalization_status: asString(state.finalization_status, "continuada") === "finalizada" ? "finalizada" : "continuada",
        finalization_reason: asString(state.finalization_reason, "sem_finalizacao"),
        finalization_actor: asString(state.finalization_actor || "") || null,
        waiting_on_agent: asBoolean(state.waiting_on_agent),
        waiting_on_customer: asBoolean(state.waiting_on_customer),
        pending_since_at: state.pending_since_at === null || state.pending_since_at === undefined ? null : asNumber(state.pending_since_at, 0),
        pending_since_at_local: asString(state.pending_since_at_local || "") || null,
        last_interaction_at_local: asString(state.last_interaction_at_local || "") || null,
        trigger_after_1h_at_local: asString(state.trigger_after_1h_at_local || "") || null,
        trigger_ready: asBoolean(state.trigger_ready),
        minutes_overdue: asNumber(state.minutes_overdue, 0),
        message_count_day: messageCountDay,
        unread_count: asNumber(state.unread_count, 0),
        status: asString(state.status || "") || null,
        labels: Array.isArray(state.labels) ? state.labels.map((v) => String(v)) : [],
        contact: { name: contactName || null, identifier: contactIdentifier || null },
      });
    }
  }

  const compactLogs = Array.isArray(reportJson.logs) ? reportJson.logs.map(asRecord) : [];
  const logs: Array<Record<string, unknown>> = compactLogs.length > 0
    ? compactLogs
    : rawAnalyses.map((item, index) => {
        const contact = asRecord(item.contact);
        const ops = Array.isArray(item.conversation_operational) ? item.conversation_operational.map(asRecord) : [];
        const firstOpState = asRecord(asRecord(ops[0]).state);
        const parsedAnswer = parseJsonObject(asRecord(item.analysis).answer);
        return {
          contact_key: String(item.contact_key || `contact-${index + 1}`),
          contact_name: String(contact.name || contact.identifier || item.contact_key || `Contato ${index + 1}`),
          conversation_ids: Array.isArray(item.conversation_ids) ? item.conversation_ids : [],
          risk_level: parsedAnswer.risco_critico ? "critical" : "non_critical",
          summary: String(parsedAnswer.resumo || ""),
          improvements: Array.isArray(parsedAnswer.pontos_melhoria) ? parsedAnswer.pontos_melhoria : [],
          next_steps: Array.isArray(parsedAnswer.proximos_passos) ? parsedAnswer.proximos_passos : [],
          finalization_status: firstOpState.finalization_status || "continuada",
          finalization_actor: firstOpState.finalization_actor || null,
          labels: Array.isArray(firstOpState.labels) ? firstOpState.labels : [],
        };
      });

  if (operationalRows.length === 0 && compactLogs.length > 0) {
    for (const log of compactLogs) {
      const conversationIds = Array.isArray(log.conversation_ids)
        ? log.conversation_ids.map((id) => asNumber(id, 0)).filter((id) => id > 0)
        : [];
      for (const conversationId of conversationIds) {
        const fallbackState = {
          finalization_status: log.finalization_status,
          finalization_reason: log.finalization_reason || log.finalization_status || "continuada",
          finalization_actor: log.finalization_actor,
          waiting_on_agent: log.waiting_on_agent,
          waiting_on_customer: log.waiting_on_customer,
          pending_since_at: log.pending_since_at,
          pending_since_at_local: log.pending_since_at_local,
          last_interaction_at_local: log.last_interaction_at_local,
          trigger_after_1h_at_local: log.trigger_after_1h_at_local,
          trigger_ready: log.trigger_ready,
          minutes_overdue: log.minutes_overdue,
          labels: log.labels,
        };
        operationalByConversation.set(conversationId, fallbackState);
        operationalRows.push({
          conversation_id: conversationId,
          contact_key: asString(log.contact_key || "contato"),
          finalization_status: asString(log.finalization_status, "continuada") === "finalizada" ? "finalizada" : "continuada",
          finalization_reason: asString(log.finalization_reason || log.finalization_status, "continuada"),
          finalization_actor: asString(log.finalization_actor || "") || null,
          waiting_on_agent: asBoolean(log.waiting_on_agent),
          waiting_on_customer: asBoolean(log.waiting_on_customer),
          pending_since_at: log.pending_since_at === null || log.pending_since_at === undefined ? null : asNumber(log.pending_since_at, 0),
          pending_since_at_local: asString(log.pending_since_at_local || "") || null,
          last_interaction_at_local: asString(log.last_interaction_at_local || "") || null,
          trigger_after_1h_at_local: asString(log.trigger_after_1h_at_local || "") || null,
          trigger_ready: asBoolean(log.trigger_ready),
          minutes_overdue: asNumber(log.minutes_overdue, 0),
          message_count_day: asNumber(log.message_count_day, 0),
          unread_count: 0,
          status: null,
          labels: Array.isArray(log.labels) ? log.labels.map((v) => String(v)) : [],
          contact: {
            name: asString(log.contact_name || log.contact_key || "") || null,
            identifier: null,
          },
        });
      }
    }
  }

  const uniqueContacts = new Set(logs.map((log) => String(log.contact_key || "")).filter(Boolean));
  const finalizedCount = logs.filter((log) => String(log.finalization_status || "").toLowerCase() === "finalizada").length;
  const criticalCount = logs.filter((log) => String(log.risk_level || "").toLowerCase() === "critical").length;
  const messageCountFromRaw = rawAnalyses.reduce((acc, item) => acc + asNumber(item.message_count_day, 0), 0);
  const messageCountFromLogs = logs.reduce((acc, item) => acc + asNumber(item.message_count_day, 0), 0);
  const messageCountFromOperations = operationalRows.reduce((acc, item) => acc + asNumber(item.message_count_day, 0), 0);
  const totalMessagesDay =
    messageCountFromOperations > 0
      ? messageCountFromOperations
      : messageCountFromRaw > 0
        ? messageCountFromRaw
        : messageCountFromLogs > 0
          ? messageCountFromLogs
          : Math.max(0, asNumber(summary.total_messages_day, 0), run.processed);
  let improvementFallbackCount = 0;
  for (const item of logs) {
    const list = Array.isArray(item.improvements) ? item.improvements : [];
    improvementFallbackCount += list.length;
  }

  const insights: InsightItem[] = logs.flatMap((log, index) => {
    const conversationIds = Array.isArray(log.conversation_ids)
      ? log.conversation_ids.map((id) => asNumber(id, 0)).filter((id) => id > 0)
      : [];

    const severity: Severity = String(log.risk_level || "").toLowerCase() === "critical" ? "critical" : "info";
    return (conversationIds.length ? conversationIds : [index + 1]).map((conversationId, subIndex) => ({
      ...(operationalByConversation.get(conversationId) || {}),
      id: `${run.id}-${index + 1}-${subIndex + 1}`,
      severity,
      title: severity === "critical" ? "Gap crítico registrado" : "Registro operacional",
      summary: String(log.summary || "Sem resumo disponível."),
      conversation_id: conversationId,
      contact_key: String(log.contact_key || `contact-${index + 1}`),
      contact_name: String(log.contact_name || log.contact_key || "Contato"),
      finalization_status:
        asString(
          (operationalByConversation.get(conversationId) || {}).finalization_status || log.finalization_status,
          "continuada",
        ).toLowerCase() === "finalizada"
          ? "finalizada"
          : "continuada",
      finalization_reason: log.finalization_actor
        ? `finalizada por ${String(log.finalization_actor)}`
        : asString((operationalByConversation.get(conversationId) || {}).finalization_reason || log.finalization_status, "continuada"),
      finalization_actor: asString((operationalByConversation.get(conversationId) || {}).finalization_actor || log.finalization_actor) || null,
      labels: Array.isArray((operationalByConversation.get(conversationId) || {}).labels)
        ? ((operationalByConversation.get(conversationId) || {}).labels as unknown[]).map((v) => String(v))
        : Array.isArray(log.labels)
          ? log.labels.map((v) => String(v))
          : [],
      status: null,
      unread_count: 0,
      last_interaction_at_local: asString((operationalByConversation.get(conversationId) || {}).last_interaction_at_local) || null,
      trigger_after_1h_at_local: asString((operationalByConversation.get(conversationId) || {}).trigger_after_1h_at_local) || null,
    }));
  });

  const conversationOperational = operationalRows.length > 0
    ? operationalRows
    : insights.map((insight) => ({
        conversation_id: insight.conversation_id,
        contact_key: insight.contact_key,
        finalization_status: insight.finalization_status,
        finalization_reason: insight.finalization_reason,
        finalization_actor: insight.finalization_actor,
        waiting_on_agent: insight.finalization_status !== "finalizada",
        waiting_on_customer: insight.finalization_status === "finalizada",
        pending_since_at: null,
        pending_since_at_local: null,
        last_interaction_at_local: insight.last_interaction_at_local || null,
        trigger_after_1h_at_local: insight.trigger_after_1h_at_local || null,
        trigger_ready: false,
        minutes_overdue: 0,
        message_count_day: 0,
        unread_count: 0,
        status: null,
        labels: [],
        contact: { name: insight.contact_name, identifier: null },
      }));

  const report: ReportPayload = {
    date: run.date_ref,
    account: {
      id: asNumber(account.id, 0),
      name: account.name ? String(account.name) : null,
      role: null,
    },
    inbox: {
      id: asNumber(inbox.id, 0),
      name: inbox.name ? String(inbox.name) : null,
      provider: inbox.provider ? String(inbox.provider) : null,
      channel_type: null,
      phone_number: null,
    },
    report_markdown: run.report_markdown || "",
    summary: {
      conversations_entered_today: asNumber(summary.conversations_entered_today, run.total_conversations),
      unique_contacts_today: asNumber(summary.unique_contacts_today, uniqueContacts.size),
      total_to_process: asNumber(summary.total_to_process, run.total_conversations),
      processed: asNumber(summary.processed, run.processed),
      analyses_count: asNumber(summary.analyses_count, logs.length),
      failures_count: asNumber(summary.failures_count, run.failure_count),
      critical_count: asNumber(summary.critical_count, criticalCount),
      improvements_count: asNumber(summary.improvements_count, improvementFallbackCount),
      gaps_count: asNumber(summary.gaps_count, criticalCount),
    },
    execution_order: [],
    raw_analysis: {
      analyses: logs.map((log, index) => {
        const contactName = String(log.contact_name || log.contact_key || `Contato ${index + 1}`);
        const improvements = Array.isArray(log.improvements) ? log.improvements.map((v) => String(v)) : [];
        const nextSteps = Array.isArray(log.next_steps) ? log.next_steps.map((v) => String(v)) : [];
        const riskCritical = String(log.risk_level || "").toLowerCase() === "critical";
        const conversationIds = Array.isArray(log.conversation_ids) ? log.conversation_ids.map((v) => asNumber(v, 0)) : [];
        const operationalItems: NonNullable<AnalysisItem["conversation_operational"]> = conversationIds.map((conversationId) => {
          const stateRaw = asRecord(operationalByConversation.get(conversationId));
          return {
            conversation_id: conversationId,
            state: {
              finalization_status: asString(stateRaw.finalization_status, "continuada") === "finalizada" ? "finalizada" : "continuada",
              finalization_reason: asString(stateRaw.finalization_reason || ""),
              finalization_actor: asString(stateRaw.finalization_actor || "") || null,
              waiting_on_agent: asBoolean(stateRaw.waiting_on_agent),
              waiting_on_customer: asBoolean(stateRaw.waiting_on_customer),
              labels: Array.isArray(stateRaw.labels) ? stateRaw.labels.map((item) => String(item)) : [],
            },
          };
        });
        return {
          analysis_index: index + 1,
          contact_key: String(log.contact_key || `contact-${index + 1}`),
          contact: { name: contactName, identifier: null },
          conversation_ids: conversationIds,
          message_count_day: asNumber(log.message_count_day, 0),
          conversation_operational: operationalItems,
          analysis: {
            answer: JSON.stringify(
              {
                resumo: String(log.summary || ""),
                pontos_melhoria: improvements,
                proximos_passos: nextSteps,
                risco_critico: riskCritical,
              },
              null,
              2,
            ),
          },
        };
      }),
      failures: [],
      run_stats: {
        total_to_process: run.total_conversations,
        processed: run.processed,
        success_count: run.success_count,
        failure_count: run.failure_count,
        success_rate: run.total_conversations > 0 ? Number(((run.success_count / run.total_conversations) * 100).toFixed(2)) : 0,
      },
    },
  };

  return {
    overview: {
      date: run.date_ref,
      timezone: "America/Fortaleza",
      generated_at: run.finished_at || run.started_at,
      account: report.account,
      inbox: report.inbox,
      overview: {
        conversations_scanned: run.total_conversations,
        conversations_entered_today: report.summary.conversations_entered_today,
        unique_contacts_today: report.summary.unique_contacts_today,
        conversations_total_analyzed_day: run.processed,
        total_analysis_count: report.summary.analyses_count,
        total_messages_day: totalMessagesDay,
        repeated_identifier_count: 0,
        finalized_count: finalizedCount,
        continued_count: Math.max(0, run.processed - finalizedCount),
        trigger_ready_count: conversationOperational.filter((item) => item.trigger_ready).length,
        critical_insights_count: criticalCount,
        non_critical_insights_count: Math.max(0, insights.length - criticalCount),
        insights_total: insights.length,
      },
      insights,
      conversation_operational: conversationOperational,
    },
    insights,
    report,
    rawOutput: run.report_markdown || "",
  };
}

export function useDashboardController(): DashboardController {
  const PROGRESS_STEPS = 6;
  const SECTION_IDS = ["inicio", "gaps", "insights", "movimentacao", "relatorio"] as const;
  const NAVBAR_HEIGHT = 68;
  const minDate = "2024-01-01";
  const maxDate = toDateInputValue();
  const [date, setDateState] = useState<string>(maxDate);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("today");
  const [loading, setLoading] = useState<ActionKey | null>(null);
  const [status, setStatus] = useState<string>("");
  const [rawOutput, setRawOutput] = useState<string>("Aguardando execução...");
  const [systemCheck, setSystemCheck] = useState<SystemCheckResponse | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [failures, setFailures] = useState<FailureItem[]>([]);
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [apiConfig, setApiConfig] = useState<ApiConfigPayload | null>(null);
  const [insightsReady, setInsightsReady] = useState<boolean>(false);
  const [insightFilter, setInsightFilter] = useState<InsightFilter>("all");
  const [insightsPage, setInsightsPage] = useState<number>(1);
  const [showTrend, setShowTrend] = useState<boolean>(false);
  const [activeNav, setActiveNav] = useState<string>("inicio");
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [overviewRunCount, setOverviewRunCount] = useState<number>(0);
  const [selectedReportContact, setSelectedReportContact] = useState<string | null>(null);
  const [reportSeverityFilter, setReportSeverityFilter] = useState<ReportSeverityFilter>("all");
  const [runTimeline, setRunTimeline] = useState<string[]>([
    "Escolha a data e clique em 'Rodar overview do dia'.",
  ]);
  const [runProgress, setRunProgress] = useState<number>(0);
  const [runCurrentContact, setRunCurrentContact] = useState<string | null>(null);
  const [reportHistory, setReportHistory] = useState<ReportHistoryResponse["items"]>([]);
  const [availableReportDates, setAvailableReportDates] = useState<string[]>([]);
  const [lastValidDate, setLastValidDate] = useState<string>(maxDate);
  const lastLoadedDateRef = useRef<string | null>(null);
  const isBusy = loading !== null;
  const isRunningOverview = loading === "overview";
  const insightsPageSize = INSIGHTS_COLLAPSED_LIMIT;

  function setDate(value: string) {
    const normalized = normalizeDateInput(value, maxDate);
    const safe = clampDateInput(normalized, minDate, maxDate);
    if (safe > maxDate) return;
    setDateState(safe);
    setLastValidDate(safe);
  }

  function applyPeriodPreset(value: PeriodPreset) {
    const now = new Date();
    setPeriodPreset(value);

    if (value === "today") {
      setDate(toDateInputValue(now));
      return;
    }
    if (value === "yesterday") {
      setDate(toDateInputValue(addDays(now, -1)));
      return;
    }
    if (value === "before_yesterday") {
      setDate(toDateInputValue(addDays(now, -2)));
      return;
    }

    const nowText = toDateInputValue(now);
    const rangeStart = new Date(now);
    if (value === "week") rangeStart.setDate(now.getDate() - 6);
    if (value === "month") rangeStart.setDate(now.getDate() - 29);
    if (value === "year") rangeStart.setDate(now.getDate() - 364);
    const fromDate = toDateInputValue(rangeStart);

    const candidate = availableReportDates.find((item) => item <= nowText && item >= fromDate);
    if (candidate) {
      setDate(candidate);
      return;
    }

    setStatus(`Nenhum relatório salvo no período ${value}. Data ajustada para referência do período.`);
    setDate(fromDate);
  }

  useEffect(() => {
    apiGet<ApiConfigPayload>("/api/config")
      .then((data) => setApiConfig(data))
      .catch(() => setApiConfig(null));
  }, []);

  useEffect(() => {
    apiGet<ReportHistoryResponse>("/api/report-day/history?limit=8")
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : [];
        setReportHistory(items);
        if (!lastRunAt && items[0]?.started_at) {
          setLastRunAt(items[0].started_at);
        }
      })
      .catch(() => setReportHistory([]));
  }, []);

  useEffect(() => {
    apiGet<AvailableDatesResponse>("/api/report-day/available-dates?limit=1000")
      .then((data) => {
        const dates = Array.isArray(data?.dates) ? data.dates : [];
        setAvailableReportDates(dates);
        if (dates.includes(date)) {
          setLastValidDate(date);
        }
      })
      .catch(() => setAvailableReportDates([]));
  }, []);

  useEffect(() => {
    const handler = () => {
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop || 0;
      const viewportHeight = window.innerHeight;
      const viewportBottom = scrollTop + viewportHeight;
      const pageBottom = doc.scrollHeight - 2;

      if (viewportBottom >= pageBottom) {
        setActiveNav("relatorio");
        return;
      }

      const probeY = scrollTop + NAVBAR_HEIGHT + 24;
      let chosen: string = "inicio";
      let bestTop = -Infinity;

      for (const id of SECTION_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.offsetTop;
        if (top <= probeY && top > bestTop) {
          bestTop = top;
          chosen = id;
        }
      }

      setActiveNav(chosen);
    };

    window.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler);
    handler();

    return () => {
      window.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  }, []);

  useEffect(() => {
    setInsightsPage(1);
  }, [insightFilter]);

  useEffect(() => {
    if (!date) return;
    if (isRunningOverview) return;
    if (availableReportDates.length > 0 && !availableReportDates.includes(date)) {
      lastLoadedDateRef.current = null;
      setOverview(null);
      setInsights([]);
      setReport(null);
      setFailures([]);
      setRawOutput("Sem relatório salvo para essa data. Você pode gerar um novo overview.");
      setInsightsReady(false);
      setShowTrend(false);
      return;
    }
    if (lastLoadedDateRef.current === date) return;

    let cancelled = false;
    lastLoadedDateRef.current = date;
    apiGet<ReportByDateResponse>(`/api/report-day/by-date?date=${encodeURIComponent(date)}`)
      .then((payload) => {
        if (cancelled || !payload?.run) return;
        const snapshot = mapRunToDashboardSnapshot(payload.run);
        setOverview(snapshot.overview);
        setInsights(snapshot.insights);
        setReport(snapshot.report);
        setFailures([]);
        setRawOutput(snapshot.rawOutput || "Relatório salvo sem conteúdo markdown.");
        setInsightsReady(true);
        setShowTrend(true);
        setLastRunAt(payload.run.started_at || new Date().toISOString());
        setStatus(`Dados atualizados automaticamente para ${date}.`);
      })
      .catch(() => {
        if (cancelled) return;
        lastLoadedDateRef.current = null;
        setStatus(`Não encontramos relatório salvo para ${date}.`);
        setOverview(null);
        setInsights([]);
        setReport(null);
        setFailures([]);
        setRawOutput("Sem relatório salvo para essa data. Você pode gerar um novo overview.");
        setInsightsReady(false);
        setShowTrend(false);
      });

    return () => {
      cancelled = true;
    };
  }, [availableReportDates, date, isRunningOverview, lastValidDate]);

  const sortedInsights = useMemo(() => {
    return [...insights].sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
  }, [insights]);

  const improvementInsights = useMemo(() => {
    return sortedInsights.filter(
      (insight) => insight.severity === "medium" || insight.severity === "low" || insight.severity === "info",
    );
  }, [sortedInsights]);

  const filteredInsights = useMemo(() => {
    if (insightFilter === "all") return improvementInsights;
    return improvementInsights.filter((insight) => insight.severity === insightFilter);
  }, [improvementInsights, insightFilter]);

  const criticalGapInsights = useMemo(() => {
    return sortedInsights.filter((insight) => insight.severity === "critical" || insight.severity === "high");
  }, [sortedInsights]);

  const totalInsightPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredInsights.length / insightsPageSize));
  }, [filteredInsights.length, insightsPageSize]);

  const visibleInsights = useMemo(() => {
    const currentPage = Math.min(insightsPage, totalInsightPages);
    const start = (currentPage - 1) * insightsPageSize;
    return filteredInsights.slice(start, start + insightsPageSize);
  }, [filteredInsights, insightsPage, insightsPageSize, totalInsightPages]);

  const severitySnapshot = useMemo(() => {
    return {
      critical: sortedInsights.filter((i) => i.severity === "critical").length,
      high: sortedInsights.filter((i) => i.severity === "high").length,
      medium: sortedInsights.filter((i) => i.severity === "medium").length,
      low: sortedInsights.filter((i) => i.severity === "low").length,
      info: sortedInsights.filter((i) => i.severity === "info").length,
    } as SeveritySnapshot;
  }, [sortedInsights]);

  const trendSeries = useMemo(() => {
    if (!overview?.conversation_operational?.length) return [] as Array<{ label: string; value: number }>;

    const hours = new Array<number>(24).fill(0);
    for (const item of overview.conversation_operational) {
      const hour = parseHour(item.last_interaction_at_local || item.trigger_after_1h_at_local);
      if (hour === null) continue;
      hours[hour] += 1;
    }

    return hours
      .map((value, hour) => ({ label: `${String(hour).padStart(2, "0")}h`, value }))
      .filter((item) => item.value > 0);
  }, [overview]);

  const metricCards = useMemo<MetricCard[]>(() => {
    const baseCards: MetricCard[] = [
      { label: "Conversas varridas", value: "—", tone: "" },
      { label: "Entraram no dia", value: "—", tone: "accent" },
      { label: "Total analisadas", value: "—", tone: "" },
      { label: "Total análises", value: "—", tone: "" },
      { label: "Números repetidos", value: "—", tone: "" },
      { label: "Finalizadas", value: "—", tone: "" },
      { label: "Continuadas", value: "—", tone: "" },
      { label: "Insights críticos", value: "—", tone: "" },
      { label: "Gatilho +1h ativo", value: "—", tone: "" },
    ];

    if (!overview) return baseCards;

    const m = overview.overview;
    return [
      { label: "Conversas varridas", value: m.conversations_scanned, tone: "" },
      { label: "Entraram no dia", value: m.conversations_entered_today, tone: "accent" },
      { label: "Total analisadas", value: m.conversations_total_analyzed_day, tone: "" },
      { label: "Total análises", value: m.total_analysis_count, tone: "" },
      { label: "Números repetidos", value: m.repeated_identifier_count ?? 0, tone: (m.repeated_identifier_count ?? 0) > 0 ? "orange" : "green" },
      { label: "Finalizadas", value: m.finalized_count, tone: "green" },
      { label: "Continuadas", value: m.continued_count, tone: "orange" },
      { label: "Insights críticos", value: m.critical_insights_count, tone: m.critical_insights_count > 0 ? "red" : "" },
      { label: "Gatilho +1h ativo", value: m.trigger_ready_count, tone: m.trigger_ready_count > 0 ? "orange" : "" },
    ];
  }, [overview]);

  const gaugeData = useMemo(() => {
    const totalInsights = overview?.overview?.insights_total || 0;
    const critical = overview?.overview?.critical_insights_count || 0;
    const score = totalInsights > 0
      ? Math.max(0, Math.round(((totalInsights - critical) / totalInsights) * 100))
      : 100;
    return { current: score, total: 100 };
  }, [overview]);

  const panoramaExtra = useMemo(() => {
    if (!overview) return "Execute o overview para consolidar os indicadores.";

    const data = overview.overview;
    return `${data.finalized_count} finalizadas • ${data.continued_count} continuadas • ${data.insights_total} insights`;
  }, [overview]);

  const riskRows = useMemo(() => {
    const snapshot = severitySnapshot;
    const total = (Object.values(snapshot) as number[]).reduce((acc, value) => acc + value, 0);

    const baseRows: Array<{ key: Severity; label: string; count: number; pct: string }> = [
      { key: "critical", label: "Crítico", count: snapshot.critical, pct: total ? ((snapshot.critical / total) * 100).toFixed(1) : "0.0" },
      { key: "high", label: "Alto", count: snapshot.high, pct: total ? ((snapshot.high / total) * 100).toFixed(1) : "0.0" },
      { key: "medium", label: "Médio", count: snapshot.medium, pct: total ? ((snapshot.medium / total) * 100).toFixed(1) : "0.0" },
      { key: "low", label: "Baixo", count: snapshot.low, pct: total ? ((snapshot.low / total) * 100).toFixed(1) : "0.0" },
      { key: "info", label: "Informação", count: snapshot.info, pct: total ? ((snapshot.info / total) * 100).toFixed(1) : "0.0" },
    ];

    const rows: RiskRow[] = baseRows.map((row) => ({ ...row }));

    return { rows, total };
  }, [severitySnapshot]);

  const selectedDateHasSavedReport = useMemo(() => {
    return availableReportDates.includes(date);
  }, [availableReportDates, date]);

  const selectedDateInfo = useMemo(() => {
    const today = maxDate;
    if (date === today) {
      return selectedDateHasSavedReport
        ? "Você está em hoje e já existe relatório salvo para esta data."
        : "Você está em hoje e ainda não existe relatório salvo.";
    }

    if (date < today) {
      return selectedDateHasSavedReport
        ? "Você está em um dia anterior com relatório salvo."
        : "Você está em um dia anterior sem relatório salvo ainda.";
    }

    return "Data fora do intervalo permitido.";
  }, [date, maxDate, selectedDateHasSavedReport]);

  const reportContacts = useMemo(() => {
    if (!report?.raw_analysis?.analyses?.length) return [] as string[];

    const unique = new Set<string>();
    for (const analysis of report.raw_analysis.analyses) {
      const name = (analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || "").trim();
      if (name) unique.add(name);
    }

    return Array.from(unique);
  }, [report]);

  const filteredFailures = useMemo(() => {
    if (!selectedReportContact) return failures;
    const needle = selectedReportContact.toLowerCase();
    return failures.filter((failure) => {
      const name = (failure.contact?.name || failure.contact?.identifier || failure.contact_key || "").toLowerCase();
      return name.includes(needle);
    });
  }, [failures, selectedReportContact]);

  const filteredReportMarkdown = useMemo(() => {
    const structured = buildStructuredReportMarkdown(report, selectedReportContact, reportSeverityFilter);
    if (structured.trim()) return structured;
    return report?.report_markdown || "";
  }, [report, selectedReportContact, reportSeverityFilter]);

  const reportLinks = useMemo(() => {
    if (!report?.raw_analysis?.analyses?.length) return [] as ReportLinkItem[];

    const baseUrl = toChatwootAppBase(apiConfig?.chatwoot_base_url || "");
    const accountId = Number(report.account?.id || 0);
    const inboxId = Number(report.inbox?.id || 0);
    const links: ReportLinkItem[] = [];
    const seen = new Set<string>();

    for (const analysis of report.raw_analysis.analyses) {
      const contactName = (analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || "").trim();
      if (!contactName) continue;
      if (selectedReportContact && selectedReportContact !== contactName) continue;

      const conversationIds = Array.isArray(analysis.conversation_ids) ? analysis.conversation_ids : [];
      for (const rawConversationId of conversationIds) {
        const conversationId = Number(rawConversationId || 0);
        const url = buildConversationLink(baseUrl, accountId, inboxId, conversationId);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        links.push({
          label: `${contactName} - conversa ${conversationId}`,
          url,
        });
      }
    }

    return links;
  }, [apiConfig?.chatwoot_base_url, report, selectedReportContact]);

  function pushRunStep(step: string) {
    setRunTimeline((current) => [...current, step]);
  }

  function updateRunProgress(step: number) {
    const normalized = Math.round((Math.max(0, Math.min(step, PROGRESS_STEPS)) / PROGRESS_STEPS) * 100);
    setRunProgress(normalized);
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function executeOverview() {
    const safeDate = clampDateInput(normalizeDateInput(date, maxDate), minDate, maxDate);
    if (safeDate !== date) {
      setDateState(safeDate);
    }

    setLoading("overview");
    setRunTimeline(["Iniciando overview do dia..."]);
    updateRunProgress(1);
    setRunCurrentContact(null);
    setInsightsReady(false);
    setShowTrend(false);
    setOverview(null);
    setInsights([]);
    setReport(null);
    setFailures([]);

    const startedAt = Date.now();

    try {
      pushRunStep("Conferindo conexão com Chatwoot e Dify...");
      updateRunProgress(2);
      const check = await apiGet<SystemCheckResponse>("/api/system-check");
      setSystemCheck(check);
      pushRunStep(`Conexões ${check.ok ? "OK" : "com alerta"}.`);

      pushRunStep("Buscando conversas do dia na caixa selecionada...");
      updateRunProgress(3);
      const preview = await apiPost<PreviewPayload>("/api/preview-day", { date: safeDate });
      pushRunStep(`Encontramos ${preview.conversations_entered_today} conversas novas hoje.`);

      pushRunStep("Montando insights e criticidade...");
      updateRunProgress(4);
      const overviewData = await apiPost<OverviewPayload>("/api/overview-day", { date: safeDate });
      let finalOverviewData: OverviewPayload | null = null;
      let finalInsights: InsightItem[] = [];
      let finalReportData: ReportPayload | null = null;
      let finalFailures: FailureItem[] = [];
      let finalRawOutput = "";

      let reportFailedMessage: string | null = null;
      try {
        updateRunProgress(5);
        const reportJob = await apiPost<ReportJobStartResponse>("/api/report-day/start", { date: safeDate });
        const maxWaitMs = 15 * 60 * 1000;
        const pollStartedAt = Date.now();
        let finalStatus: ReportJobStatusResponse | null = null;

        while (Date.now() - pollStartedAt < maxWaitMs) {
          await sleep(1200);
          const statusData = await apiGet<ReportJobStatusResponse>(
            `/api/report-day/status?job_id=${encodeURIComponent(reportJob.job_id)}`,
          );

          finalStatus = statusData;

          const total = Math.max(0, Number(statusData.total || 0));
          const processed = Math.max(0, Number(statusData.processed || 0));

          if (statusData.current_contact) {
            const current = statusData.current_contact;
            const safeTotal = current.total || total || 0;
            setRunCurrentContact(
              `${current.contact_name} (${current.sequence}/${safeTotal > 0 ? safeTotal : "?"})`,
            );
          }

          if (total > 0) {
            const ratio = Math.min(1, processed / total);
            const mapped = 67 + Math.round(ratio * 29);
            setRunProgress((current) => Math.max(current, Math.min(mapped, 96)));
          }

          if (statusData.status === "completed") {
            break;
          }

          if (statusData.status === "failed") {
            throw new Error(statusData.error || "Falha ao gerar relatório.");
          }
        }

        if (!finalStatus || finalStatus.status !== "completed" || !finalStatus.result) {
          throw new Error("Tempo de espera excedido ao gerar relatório.");
        }

        const reportData = finalStatus.result as ReportPayload;
        finalReportData = reportData;
        finalFailures = reportData.raw_analysis?.failures || [];
        finalOverviewData = overviewData;
        finalInsights = overviewData.insights || [];
        let persistedMarkdown = reportData.report_markdown || "";
        const runId = String(finalStatus.db_run_id || "").trim();
        if (runId) {
          try {
            const runSnapshot = await apiGet<ReportRunResponse>(`/api/report-day/run?run_id=${encodeURIComponent(runId)}`);
            persistedMarkdown = runSnapshot.report_markdown || persistedMarkdown;
          } catch {
            // fallback para resultado local em memória
          }
        }
        finalRawOutput = persistedMarkdown || JSON.stringify(reportData, null, 2);
        pushRunStep("Relatório final gerado com sucesso.");
        setRunCurrentContact(null);
      } catch (reportError) {
        const reportMessage = reportError instanceof Error ? reportError.message : "Erro ao gerar relatório";
        reportFailedMessage = reportMessage;
        finalOverviewData = null;
        finalInsights = [];
        finalReportData = null;
        finalFailures = [];
        finalRawOutput = JSON.stringify({ system_check: check, overview: overviewData, report_error: reportMessage }, null, 2);
        pushRunStep(`Não conseguimos gerar o relatório: ${reportMessage}`);
        setRunCurrentContact(null);
      }

      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      if (reportFailedMessage) {
        setStatus(`Overview concluído em ${elapsed}s. Relatório falhou: ${reportFailedMessage}`);
      } else {
        setOverview(finalOverviewData);
        setInsights(finalInsights);
        setReport(finalReportData);
        setFailures(finalFailures);
        setRawOutput(finalRawOutput);
        setShowTrend(true);
        setInsightsReady(true);
        setInsightFilter("all");
        setInsightsPage(1);
        setLastRunAt(new Date().toISOString());
        setOverviewRunCount((value) => value + 1);
        setSelectedReportContact(null);
        setReportSeverityFilter("all");
        setStatus(`Overview concluído em ${elapsed}s. Conexões ${check.ok ? "OK" : "com alerta"}.`);
      }
      pushRunStep(`Overview finalizado em ${elapsed}s.`);
      updateRunProgress(6);
      setRunTimeline([]);
      apiGet<ReportHistoryResponse>("/api/report-day/history?limit=8")
        .then((data) => setReportHistory(Array.isArray(data?.items) ? data.items : []))
        .catch(() => undefined);
      apiGet<AvailableDatesResponse>("/api/report-day/available-dates?limit=1000")
        .then((data) => {
          lastLoadedDateRef.current = null;
          setAvailableReportDates(Array.isArray(data?.dates) ? data.dates : []);
        })
        .catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha não identificada";
      setStatus(`Erro: ${message}`);
      setRawOutput(`Erro: ${message}`);
      pushRunStep(`Parou com erro: ${message}`);
      setRunCurrentContact(null);
      setRunTimeline([]);
    } finally {
      setLoading(null);
    }
  }

  const navClass = (section: string) => (activeNav === section ? "active" : "");

  const focusReportByContact = (contactName: string) => {
    const clean = String(contactName || "").trim();
    if (!clean) return;
    setSelectedReportContact(clean);
    setActiveNav("relatorio");
    const target = document.getElementById("relatorio");
    if (!target) return;
    const top = Math.max(0, target.offsetTop - NAVBAR_HEIGHT);
    window.scrollTo({ top, behavior: "smooth" });
  };

  const navigateToSection = (section: string) => {
    const target = document.getElementById(section);
    if (!target) return;

    const top = Math.max(0, target.offsetTop - NAVBAR_HEIGHT);
    window.scrollTo({ top, behavior: "smooth" });
    setActiveNav(section);
  };

  return {
    date,
    setDate,
    minDate,
    maxDate,
    periodPreset,
    applyPeriodPreset,
    status,
    loading,
    isBusy,
    isRunningOverview,
    lastRunAt,
    activeNav,
    navClass,
    navigateToSection,
    executeOverview,
    apiConfig,
    systemCheck,
    overview,
    report,
    failures,
    filteredFailures,
    insightsReady,
    insightFilter,
    setInsightFilter,
    insightsPage,
    totalInsightPages,
    setInsightsPage,
    filteredInsights,
    allInsights: sortedInsights,
    criticalGapInsights,
    visibleInsights,
    insightsPageSize,
    severitySnapshot,
    metricCards,
    panoramaExtra,
    gaugeData,
    showTrend,
    trendSeries,
    riskRows,
    reportContacts,
    selectedReportContact,
    setSelectedReportContact,
    reportSeverityFilter,
    setReportSeverityFilter,
    filteredReportMarkdown,
    rawOutput,
    overviewRunCount,
    runTimeline,
    runProgress,
    runCurrentContact,
    reportLinks,
    reportHistory,
    selectedDateInfo,
    selectedDateHasSavedReport,
    focusReportByContact,
  };
}




