import type {
  FailureItem,
  InsightItem,
  OverviewPayload,
  ReportPayload,
  Severity,
} from "../../../../types";
import { INSIGHTS_COLLAPSED_LIMIT, severityOrder } from "../../shared/constants";
import { parseHour } from "../../shared/helpers";
import type {
  MetricCard,
  ReportLinkItem,
  RiskRow,
  SeveritySnapshot,
} from "../../shared/types";
import {
  addDays,
  buildConversationLink,
  parseHourlyRolesFromLogText,
  parseJsonObject,
  toChatwootAppBase,
  toTitleCaseName,
  type ReportSeverityFilter,
} from "./common";
import { buildStructuredReportMarkdown } from "./reportMarkdown";

export function buildInformationalInsights(report: ReportPayload | null, insights: InsightItem[]): InsightItem[] {
  const analyses = report?.raw_analysis?.analyses || [];
  const contextual: InsightItem[] = [];

  analyses.forEach((analysis, analysisIndex) => {
    const parsed = parseJsonObject(String(analysis.analysis?.answer || ""));
    const contextItems = Array.isArray(parsed.contexto_informativo)
      ? parsed.contexto_informativo.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

    const fallbackSummary = String(parsed.resumo || "").trim();
    const lines = contextItems.length > 0 ? contextItems : fallbackSummary ? [fallbackSummary] : [];
    if (lines.length === 0) return;

    const contactName = toTitleCaseName(
      analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || "Contato",
    );
    const conversationId = Number((analysis.conversation_ids || [0])[0] || analysisIndex + 1);
    const firstState = analysis.conversation_operational?.[0]?.state;
    const finalizationStatus =
      String(firstState?.finalization_status || "").toLowerCase() === "finalizada" ? "finalizada" : "continuada";
    const finalizationReason =
      String(firstState?.finalization_reason || "").trim() ||
      (finalizationStatus === "finalizada" ? "finalizada" : "continuada");
    const labels = Array.isArray(firstState?.labels) ? firstState.labels.map((item) => String(item || "")) : [];

    lines.forEach((line, lineIndex) => {
      contextual.push({
        id: `ctx-${analysis.contact_key || analysisIndex}-${lineIndex}`,
        severity: "info",
        title: "Contexto informativo",
        summary: line,
        conversation_id: conversationId > 0 ? conversationId : analysisIndex + 1,
        contact_key: String(analysis.contact_key || `contact-${analysisIndex + 1}`),
        contact_name: contactName || "Contato",
        finalization_status: finalizationStatus,
        finalization_reason: finalizationReason,
        finalization_actor: firstState?.finalization_actor || null,
        labels,
        status: null,
        unread_count: 0,
        last_interaction_at_local: null,
        trigger_after_1h_at_local: null,
      });
    });
  });

  if (contextual.length > 0) return contextual;
  return insights.filter((insight) => insight.severity === "info");
}

export function buildSortedInsights(insights: InsightItem[]): InsightItem[] {
  return [...insights]
    .filter((insight) => insight.severity !== "info")
    .sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
}

export function buildAllInsights(insights: InsightItem[]): InsightItem[] {
  return [...insights].sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
}

export function buildSeveritySnapshot(sortedInsights: InsightItem[]): SeveritySnapshot {
  return {
    critical: sortedInsights.filter((i) => i.severity === "critical").length,
    high: sortedInsights.filter((i) => i.severity === "high").length,
    medium: sortedInsights.filter((i) => i.severity === "medium").length,
    low: sortedInsights.filter((i) => i.severity === "low").length,
    info: 0,
  };
}

export function buildTrendSeries(
  overview: OverviewPayload | null,
  report: ReportPayload | null,
): Array<{ label: string; conversas: number; ia: number; usuario: number }> {
  const hourlyConversations = new Array<number>(24).fill(0);
  const hourlyIa = new Array<number>(24).fill(0);
  const hourlyUsuario = new Array<number>(24).fill(0);

  if (overview?.conversation_operational?.length) {
    for (const item of overview.conversation_operational) {
      const hour = parseHour(item.last_interaction_at_local || item.trigger_after_1h_at_local);
      if (hour === null || hour < 0 || hour > 23) continue;
      hourlyConversations[hour] += 1;
    }
  }

  if (report?.raw_analysis?.analyses?.length) {
    for (const analysis of report.raw_analysis.analyses) {
      const pairs = parseHourlyRolesFromLogText(analysis.log_text || "");
      for (const pair of pairs) {
        if (pair.hour < 0 || pair.hour > 23) continue;
        if (pair.role === "AGENT") hourlyIa[pair.hour] += 1;
        else hourlyUsuario[pair.hour] += 1;
      }
    }
  }

  const hasConversations = hourlyConversations.some((value) => value > 0);
  const hasRoles = hourlyIa.some((value) => value > 0) || hourlyUsuario.some((value) => value > 0);
  if (!hasConversations && !hasRoles) return [];

  return hourlyConversations.map((conversas, hour) => ({
    label: `${String(hour).padStart(2, "0")}h`,
    conversas,
    ia: hourlyIa[hour],
    usuario: hourlyUsuario[hour],
  }));
}

export function buildMetricCards(overview: OverviewPayload | null): MetricCard[] {
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
    {
      label: "Números repetidos",
      value: m.repeated_identifier_count ?? 0,
      tone: (m.repeated_identifier_count ?? 0) > 0 ? "orange" : "green",
    },
    { label: "Finalizadas", value: m.finalized_count, tone: "green" },
    { label: "Continuadas", value: m.continued_count, tone: "orange" },
    {
      label: "Insights críticos",
      value: m.critical_insights_count,
      tone: m.critical_insights_count > 0 ? "red" : "",
    },
    { label: "Gatilho +1h ativo", value: m.trigger_ready_count, tone: m.trigger_ready_count > 0 ? "orange" : "" },
  ];
}

export function buildGaugeData(severitySnapshot: SeveritySnapshot): { current: number; total: number } {
  const total =
    severitySnapshot.critical + severitySnapshot.high + severitySnapshot.medium + severitySnapshot.low;
  const critical = severitySnapshot.critical;
  const score = total > 0 ? Math.max(0, Math.round(((total - critical) / total) * 100)) : 100;
  return { current: score, total: 100 };
}

export function buildPanoramaExtra(overview: OverviewPayload | null): string {
  if (!overview) return "Execute o overview para consolidar os indicadores.";
  const data = overview.overview;
  return `${data.finalized_count} finalizadas • ${data.continued_count} continuadas • ${data.insights_total} insights`;
}

export function buildRiskRows(severitySnapshot: SeveritySnapshot): { rows: RiskRow[]; total: number } {
  const snapshot = severitySnapshot;
  const total = snapshot.critical + snapshot.high + snapshot.medium + snapshot.low;

  const baseRows: Array<{ key: Severity; label: string; count: number; pct: string }> = [
    {
      key: "critical",
      label: "Crítico",
      count: snapshot.critical,
      pct: total ? ((snapshot.critical / total) * 100).toFixed(1) : "0.0",
    },
    {
      key: "high",
      label: "Alto",
      count: snapshot.high,
      pct: total ? ((snapshot.high / total) * 100).toFixed(1) : "0.0",
    },
    {
      key: "medium",
      label: "Médio",
      count: snapshot.medium,
      pct: total ? ((snapshot.medium / total) * 100).toFixed(1) : "0.0",
    },
    { key: "low", label: "Baixo", count: snapshot.low, pct: total ? ((snapshot.low / total) * 100).toFixed(1) : "0.0" },
  ];

  const rows: RiskRow[] = baseRows.map((row) => ({ ...row }));
  return { rows, total };
}

export function buildSelectedDateInfo(params: {
  date: string;
  maxDate: string;
  isLoadingDateReport: boolean;
  periodPreset: "today" | "yesterday" | "before_yesterday" | "week" | "month" | "year" | "total";
  selectedDateHasSavedReport: boolean;
}): string {
  const { date, maxDate, isLoadingDateReport, periodPreset, selectedDateHasSavedReport } = params;

  if (isLoadingDateReport) return "Carregando relatório salvo da data selecionada...";
  if (periodPreset === "total") return "Você está visualizando o consolidado total das execuções salvas.";

  const today = maxDate;
  const yesterday = addDays(new Date(today), -1).toISOString().slice(0, 10);
  const dayBeforeYesterday = addDays(new Date(today), -2).toISOString().slice(0, 10);

  if (date === today) {
    return selectedDateHasSavedReport
      ? "Você está em hoje e já existe relatório salvo para esta data."
      : "Você está em hoje e ainda não existe relatório salvo.";
  }
  if (date === yesterday) {
    return selectedDateHasSavedReport
      ? "Você está em ontem com relatório salvo."
      : "Você está em ontem sem relatório salvo ainda.";
  }
  if (date === dayBeforeYesterday) {
    return selectedDateHasSavedReport
      ? "Você está em anteontem com relatório salvo."
      : "Você está em anteontem sem relatório salvo ainda.";
  }
  if (date < today) {
    return selectedDateHasSavedReport
      ? "Você está em um dia personalizado com relatório salvo."
      : "Você está em um dia personalizado sem relatório salvo ainda.";
  }
  return "Data fora do intervalo permitido.";
}

export function buildReportContacts(report: ReportPayload | null): string[] {
  if (!report?.raw_analysis?.analyses?.length) return [];
  const unique = new Set<string>();
  for (const analysis of report.raw_analysis.analyses) {
    const name = toTitleCaseName(analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || "");
    if (name) unique.add(name);
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function filterFailuresByContact(failures: FailureItem[], selectedReportContact: string | null): FailureItem[] {
  if (!selectedReportContact) return failures;
  const needle = selectedReportContact.toLowerCase();
  return failures.filter((failure) => {
    const name = (failure.contact?.name || failure.contact?.identifier || failure.contact_key || "").toLowerCase();
    return name.includes(needle);
  });
}

export function buildFilteredReportMarkdown(
  report: ReportPayload | null,
  selectedReportContact: string | null,
  reportSeverityFilter: ReportSeverityFilter,
): string {
  const structured = buildStructuredReportMarkdown(report, selectedReportContact, reportSeverityFilter);
  if (structured.trim()) return structured;
  return report?.report_markdown || "";
}

export function buildReportLinks(params: {
  report: ReportPayload | null;
  selectedReportContact: string | null;
  chatwootBaseUrl: string;
}): ReportLinkItem[] {
  const { report, selectedReportContact, chatwootBaseUrl } = params;
  if (!report?.raw_analysis?.analyses?.length) return [];

  const baseUrl = toChatwootAppBase(chatwootBaseUrl || "");
  const accountId = Number(report.account?.id || 0);
  const inboxId = Number(report.inbox?.id || 0);
  const links: ReportLinkItem[] = [];
  const seen = new Set<string>();

  for (const analysis of report.raw_analysis.analyses) {
    const contactName = toTitleCaseName(analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || "");
    if (!contactName) continue;
    if (selectedReportContact && selectedReportContact !== contactName) continue;

    const conversationIds = Array.isArray(analysis.conversation_ids) ? analysis.conversation_ids : [];
    for (const rawConversationId of conversationIds) {
      const conversationId = Number(rawConversationId || 0);
      const url = buildConversationLink(baseUrl, accountId, inboxId, conversationId);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      links.push({ label: `${contactName} - conversa ${conversationId}`, url });
    }
  }

  return links;
}

export function clampInsightsPageSize(): number {
  return INSIGHTS_COLLAPSED_LIMIT;
}
