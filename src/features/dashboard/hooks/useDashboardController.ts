import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
import type {
  AnalysisItem,
  AvailableDatesResponse,
  FailureItem,
  InsightItem,
  OverviewPayload,
  ReportByDateResponse,
  ReportHistoryResponse,
  ReportJobStartResponse,
  ReportJobStatusResponse,
  ReportPayload,
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
import {
  addDays,
  buildConversationLink,
  parseHourlyRolesFromLogText,
  toChatwootAppBase,
  type ReportSeverityFilter,
} from "./controller/common";
import { buildStructuredReportMarkdown } from "./controller/reportMarkdown";
import { aggregateSnapshots } from "./controller/periodAggregation";
import type { DashboardRunSnapshot } from "./controller/runSnapshotMapper";
import { mapRunToDashboardSnapshot } from "./controller/runSnapshotMapper";
import {
  buildClientResponseStats,
  extractOperationalAlerts,
  extractProductDemand,
} from "./controller/operationalSignals";

export function useDashboardController(options?: { enabled?: boolean }): DashboardController {
  const enabled = options?.enabled ?? true;
  const SELECTED_DATE_STORAGE_KEY = "hile_selected_date_v1";
  const PROGRESS_STEPS = 6;
  const SECTION_IDS = ["inicio", "gaps", "insights", "movimentacao", "relatorio"] as const;
  const NAVBAR_HEIGHT = 68;
  const minDate = "2024-01-01";
  const maxDate = toDateInputValue();
  const [date, setDateState] = useState<string>(maxDate);
  const [isDateHydrated, setIsDateHydrated] = useState<boolean>(false);
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
  const activeNavRef = useRef<string>("inicio");
  const navFreezeUntilRef = useRef<number>(0);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [overviewRunCount, setOverviewRunCount] = useState<number>(0);
  const [selectedReportContact, setSelectedReportContact] = useState<string | null>(null);
  const [reportSeverityFilter, setReportSeverityFilter] = useState<ReportSeverityFilter>("all");
  const [runTimeline, setRunTimeline] = useState<string[]>([
    "Escolha a data e clique em 'Rodar overview do dia'.",
  ]);
  const [runProgress, setRunProgress] = useState<number>(0);
  const [runCurrentContact, setRunCurrentContact] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [reportHistory, setReportHistory] = useState<ReportHistoryResponse["items"]>([]);
  const [availableReportDates, setAvailableReportDates] = useState<string[]>([]);
  const [hasLoadedAvailableDates, setHasLoadedAvailableDates] = useState<boolean>(false);
  const [isLoadingDateReport, setIsLoadingDateReport] = useState<boolean>(false);
  const [lastValidDate, setLastValidDate] = useState<string>(maxDate);
  const lastLoadedDateRef = useRef<string | null>(null);
  const missingReportDatesRef = useRef<Set<string>>(new Set());
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

  const isPeriodMode = periodPreset === "week" || periodPreset === "month" || periodPreset === "year";
  const loadedPeriodDatesRef = useRef<string | null>(null);
  const isLoadingPeriodRef = useRef(false);

  async function loadPeriodData(preset: PeriodPreset, dates: string[]) {
    if (isLoadingPeriodRef.current) return;

    const now = new Date();
    const toDate = toDateInputValue(now);
    const from = new Date(now);
    if (preset === "week") from.setDate(now.getDate() - 6);
    else if (preset === "month") from.setDate(now.getDate() - 29);
    else if (preset === "year") from.setDate(now.getDate() - 364);
    const fromDate = toDateInputValue(from);

    const datesInRange = [...dates]
      .filter((d) => d >= fromDate && d <= toDate)
      .sort();

    if (datesInRange.length === 0) {
      setStatus("Nenhum relatório salvo no período selecionado.");
      setOverview(null);
      setInsights([]);
      setReport(null);
      setFailures([]);
      setRawOutput("Sem relatórios no período.");
      setInsightsReady(false);
      setShowTrend(false);
      return;
    }

    const periodKey = `${preset}-${datesInRange.join(",")}`;
    if (loadedPeriodDatesRef.current === periodKey) return;

    isLoadingPeriodRef.current = true;
    setStatus(`Agregando dados de ${datesInRange.length} dia(s)...`);
    setOverview(null);
    setInsights([]);
    setReport(null);
    setFailures([]);
    setRawOutput("Carregando dados do período...");
    setInsightsReady(false);
    setShowTrend(false);

    try {
      const promises = datesInRange.map((d) =>
        apiGet<ReportByDateResponse>(`/api/report-day/by-date?date=${encodeURIComponent(d)}`)
          .then((payload) => (payload?.run ? mapRunToDashboardSnapshot(payload.run) : null))
          .catch(() => null),
      );

      const results = (await Promise.all(promises)).filter((r): r is DashboardRunSnapshot => r !== null);

      if (results.length === 0) {
        setStatus("Nenhum relatório carregado no período.");
        isLoadingPeriodRef.current = false;
        return;
      }

      loadedPeriodDatesRef.current = periodKey;
      const dateLabel = `${fromDate} a ${toDate}`;
      const aggregated = aggregateSnapshots(results, dateLabel);
      setOverview(aggregated.overview);
      setInsights(aggregated.insights);
      setReport(aggregated.report);
      setFailures(aggregated.report?.raw_analysis?.failures || []);
      setRawOutput(aggregated.rawOutput);
      setInsightsReady(true);
      setShowTrend(true);
      setLastRunAt(new Date().toISOString());
      setStatus(`Período agregado: ${datesInRange.length} dia(s), ${aggregated.insights.length} contato(s), ${aggregated.overview.overview.critical_insights_count} crítico(s).`);
    } catch (err) {
      loadedPeriodDatesRef.current = null;
      setOverview(null);
      setInsights([]);
      setReport(null);
      setFailures([]);
      setRawOutput("Erro ao agregar período.");
      setInsightsReady(false);
      setShowTrend(false);
      setStatus(`Erro ao carregar período: ${err instanceof Error ? err.message : "Erro desconhecido"}`);
    } finally {
      isLoadingPeriodRef.current = false;
    }
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

    loadedPeriodDatesRef.current = null;
    void loadPeriodData(value, availableReportDates);
  }

  useEffect(() => {
    if (!enabled) return;
    try {
      const savedDate = String(localStorage.getItem(SELECTED_DATE_STORAGE_KEY) || "").trim();
      if (savedDate) {
        const normalized = normalizeDateInput(savedDate, maxDate);
        const safe = clampDateInput(normalized, minDate, maxDate);
        setDateState(safe);
        setLastValidDate(safe);
      }
    } catch {
      // noop
    } finally {
      setIsDateHydrated(true);
    }
  }, [enabled, maxDate, minDate]);

  useEffect(() => {
    if (!enabled || !isDateHydrated) return;
    try {
      localStorage.setItem(SELECTED_DATE_STORAGE_KEY, date);
    } catch {
      // noop
    }
  }, [date, enabled, isDateHydrated]);

  useEffect(() => {
    if (!enabled) return;
    apiGet<ApiConfigPayload>("/api/config")
      .then((data) => setApiConfig(data))
      .catch(() => setApiConfig(null));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    apiGet<ReportHistoryResponse>("/api/report-day/history?limit=8")
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : [];
        setReportHistory(items);
        if (!lastRunAt && items[0]?.started_at) {
          setLastRunAt(items[0].started_at);
        }
      })
      .catch(() => setReportHistory([]));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    apiGet<AvailableDatesResponse>("/api/report-day/available-dates?limit=1000")
      .then((data) => {
        const dates = Array.isArray(data?.dates) ? data.dates : [];
        setAvailableReportDates(dates);
        missingReportDatesRef.current = new Set(
          [...missingReportDatesRef.current].filter((item) => !dates.includes(item)),
        );
        setHasLoadedAvailableDates(true);
        if (dates.includes(date)) {
          setLastValidDate(date);
        }
        if (periodPreset === "week" || periodPreset === "month" || periodPreset === "year") {
          loadedPeriodDatesRef.current = null;
          loadPeriodData(periodPreset, dates);
        }
      })
      .catch(() => {
        setAvailableReportDates([]);
        setHasLoadedAvailableDates(true);
        if (periodPreset === "week" || periodPreset === "month" || periodPreset === "year") {
          loadedPeriodDatesRef.current = null;
          loadPeriodData(periodPreset, []);
        }
      });
  }, [enabled]);

  useEffect(() => {
    activeNavRef.current = activeNav;
  }, [activeNav]);

  useEffect(() => {
    if (!enabled) return;
    const handler = () => {
      if (Date.now() < navFreezeUntilRef.current) return;

      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop || 0;
      const viewportHeight = window.innerHeight;
      const viewportBottom = scrollTop + viewportHeight;
      const pageBottom = doc.scrollHeight - 2;

      if (viewportBottom >= pageBottom) {
        if (activeNavRef.current !== "relatorio") {
          activeNavRef.current = "relatorio";
          setActiveNav("relatorio");
        }
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

      if (activeNavRef.current !== chosen) {
        activeNavRef.current = chosen;
        setActiveNav(chosen);
      }
    };

    window.addEventListener("scroll", handler, { passive: true });
    window.addEventListener("resize", handler);
    handler();

    return () => {
      window.removeEventListener("scroll", handler);
      window.removeEventListener("resize", handler);
    };
  }, [enabled]);

  useEffect(() => {
    setInsightsPage(1);
  }, [insightFilter]);

  useEffect(() => {
    if (!enabled) return;
    if (!isDateHydrated) return;
    if (!date) return;
    if (isRunningOverview) return;
    if (!hasLoadedAvailableDates) return;
    if (isPeriodMode) return;

    const clearLoadedReportView = (message: string) => {
      setOverview(null);
      setInsights([]);
      setReport(null);
      setFailures([]);
      setRawOutput("Sem relatório salvo para essa data. Você pode gerar um novo overview.");
      setInsightsReady(false);
      setShowTrend(false);
      setStatus(message);
    };

    if (missingReportDatesRef.current.has(date)) {
      clearLoadedReportView(`Não encontramos relatório salvo para ${date}.`);
      return;
    }

    if (lastLoadedDateRef.current === date) return;

    let cancelled = false;
    lastLoadedDateRef.current = date;
    setOverview(null);
    setInsights([]);
    setReport(null);
    setFailures([]);
    setRawOutput("Carregando relatório salvo da data selecionada...");
    setInsightsReady(false);
    setShowTrend(false);
    setIsLoadingDateReport(true);
    setStatus(`Carregando relatório salvo de ${date}...`);
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
        setAvailableReportDates((current) => (current.includes(date) ? current : [date, ...current]));
      })
      .catch(() => {
        if (cancelled) return;
        missingReportDatesRef.current.add(date);
        clearLoadedReportView(`Não encontramos relatório salvo para ${date}.`);
        setAvailableReportDates((current) => (current.includes(date) ? current.filter((item) => item !== date) : current));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingDateReport(false);
      });

    return () => {
      cancelled = true;
    };
  }, [date, enabled, hasLoadedAvailableDates, isDateHydrated, isRunningOverview, isPeriodMode]);

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
          if (pair.role === "AGENT") {
            hourlyIa[pair.hour] += 1;
          } else {
            hourlyUsuario[pair.hour] += 1;
          }
        }
      }
    }

    const hasConversations = hourlyConversations.some((value) => value > 0);
    const hasRoles = hourlyIa.some((value) => value > 0) || hourlyUsuario.some((value) => value > 0);
    if (!hasConversations && !hasRoles) return [] as Array<{ label: string; conversas: number; ia: number; usuario: number }>;

    return hourlyConversations
      .map((conversas, hour) => ({
        label: `${String(hour).padStart(2, "0")}h`,
        conversas,
        ia: hourlyIa[hour],
        usuario: hourlyUsuario[hour],
      }))
      .filter((item) => item.conversas > 0 || item.ia > 0 || item.usuario > 0);
  }, [overview, report]);

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

  const operationalAlerts = useMemo(() => {
    const analyses = report?.raw_analysis?.analyses || [];
    return extractOperationalAlerts(analyses);
  }, [report?.raw_analysis?.analyses]);

  const productDemand = useMemo(() => {
    const analyses = report?.raw_analysis?.analyses || [];
    return extractProductDemand(analyses);
  }, [report?.raw_analysis?.analyses]);

  const clientResponseStats = useMemo(() => {
    const analyses = report?.raw_analysis?.analyses || [];
    return buildClientResponseStats(analyses);
  }, [report?.raw_analysis?.analyses]);

  const selectedDateHasSavedReport = useMemo(() => {
    const loadedReportDate = String(report?.date || "").trim();
    return availableReportDates.includes(date) || loadedReportDate === date;
  }, [availableReportDates, date, report?.date]);

  const selectedDateInfo = useMemo(() => {
    if (isLoadingDateReport) {
      return "Carregando relatório salvo da data selecionada...";
    }

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
        ? "Você está em um dia anterior com relatório salvo."
        : "Você está em um dia anterior sem relatório salvo ainda.";
    }

    return "Data fora do intervalo permitido.";
  }, [date, isLoadingDateReport, maxDate, selectedDateHasSavedReport]);

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
    setRunTimeline((current) => [...current.slice(-49), step]);
  }

  function updateRunProgress(step: number) {
    const normalized = Math.round((Math.max(0, Math.min(step, PROGRESS_STEPS)) / PROGRESS_STEPS) * 100);
    setRunProgress(normalized);
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function executeOverview() {
    if (!enabled) return;
    const safeDate = clampDateInput(normalizeDateInput(date, maxDate), minDate, maxDate);
    if (safeDate !== date) {
      setDateState(safeDate);
    }

    setLoading("overview");
    setRunTimeline(["Iniciando overview do dia..."]);
    updateRunProgress(1);
    setRunCurrentContact(null);
    setRunStartedAt(Date.now());
    setCurrentRunId(null);
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

      pushRunStep("Iniciando execução do relatório do dia...");
      updateRunProgress(3);
      let finalOverviewData: OverviewPayload | null = null;
      let finalInsights: InsightItem[] = [];
      let finalReportData: ReportPayload | null = null;
      let finalFailures: FailureItem[] = [];
      let finalRawOutput = "";

      let reportFailedMessage: string | null = null;
      try {
        updateRunProgress(4);
        const reportJob = await apiPost<ReportJobStartResponse>("/api/report-day/start", {
          date: safeDate,
        });
        setCurrentRunId(reportJob.db_run_id || null);
        pushRunStep(
          `${reportJob.already_running ? "Execução já em andamento" : "Execução iniciada"} (job ${reportJob.job_id.slice(0, 8)}${
            reportJob.db_run_id ? ` • run ${reportJob.db_run_id.slice(0, 8)}` : ""
          }).`,
        );
        const maxWaitMs = 15 * 60 * 1000;
        const pollStartedAt = Date.now();
        let finalStatus: ReportJobStatusResponse | null = null;
        let lastProcessed = -1;
        let lastCurrentContactKey = "";

        while (Date.now() - pollStartedAt < maxWaitMs) {
          await sleep(1200);
          const runIdQuery = reportJob.db_run_id ? `&run_id=${encodeURIComponent(reportJob.db_run_id)}` : "";
          const statusData = await apiGet<ReportJobStatusResponse>(
            `/api/report-day/status?job_id=${encodeURIComponent(reportJob.job_id)}${runIdQuery}`,
          );

          finalStatus = statusData;

          const total = Math.max(0, Number(statusData.total || 0));
          const processed = Math.max(0, Number(statusData.processed || 0));

          if (statusData.current_contact) {
            const current = statusData.current_contact;
            const safeTotal = current.total || total || 0;
            const signature = `${current.contact_key}-${current.sequence}-${safeTotal}`;
            setRunCurrentContact(
              `${current.contact_name} (${current.sequence}/${safeTotal > 0 ? safeTotal : "?"})`,
            );
            if (signature !== lastCurrentContactKey) {
              lastCurrentContactKey = signature;
              pushRunStep(
                `Analisando contato ${current.sequence}/${safeTotal > 0 ? safeTotal : "?"}: ${current.contact_name} (${current.contact_key}).`,
              );
            }
          }

          if (total > 0) {
            const ratio = Math.min(1, processed / total);
            setRunProgress(Math.round(ratio * 100));
          }
          if (processed !== lastProcessed) {
            lastProcessed = processed;
            pushRunStep(`Progresso: ${processed}/${total || "?"} contato(s) processado(s).`);
          }

          if (statusData.status === "completed") {
            break;
          }

          if (statusData.status === "failed") {
            throw new Error(statusData.error || "Falha ao gerar relatório.");
          }
        }

        if (!finalStatus || finalStatus.status !== "completed") {
          throw new Error("Tempo de espera excedido ao gerar relatório.");
        }

        let reportData: ReportPayload | null = finalStatus.result as ReportPayload | null;
        let persistedByDate: ReportByDateResponse | null = null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          try {
            const payload = await apiGet<ReportByDateResponse>(
              `/api/report-day/by-date?date=${encodeURIComponent(safeDate)}`,
            );
            if (payload?.run) {
              persistedByDate = payload;
              break;
            }
          } catch {
            // tenta novamente
          }
          await sleep(700);
        }

        if (persistedByDate?.run) {
          const mappedSnapshot = mapRunToDashboardSnapshot(persistedByDate.run);
          finalOverviewData = mappedSnapshot.overview;
          finalInsights = mappedSnapshot.insights || [];
          finalReportData = mappedSnapshot.report;
          finalFailures = mappedSnapshot.report.raw_analysis?.failures || [];
          if (!reportData) {
            reportData = mappedSnapshot.report;
          }
          finalRawOutput = mappedSnapshot.rawOutput || reportData.report_markdown || JSON.stringify(reportData, null, 2);
        } else if (reportData) {
          finalOverviewData = overview;
          finalInsights = insights;
          finalReportData = reportData;
          finalFailures = [];
          finalRawOutput = reportData.report_markdown || JSON.stringify(reportData, null, 2);
          pushRunStep("Relatório concluído e exibido a partir do retorno imediato; persistência finalizando em background.");
        } else {
          throw new Error("Relatório concluído, mas o payload final não foi localizado.");
        }
        pushRunStep("Relatório final gerado com sucesso.");
        setRunCurrentContact(null);
      } catch (reportError) {
        const reportMessage = reportError instanceof Error ? reportError.message : "Erro ao gerar relatório";
        reportFailedMessage = reportMessage;
        finalOverviewData = null;
        finalInsights = [];
        finalReportData = null;
        finalFailures = [];
        finalRawOutput = JSON.stringify({ system_check: check, report_error: reportMessage }, null, 2);
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
      setRunProgress(100);
      setRunStartedAt(null);
      setCurrentRunId(null);
      apiGet<ReportHistoryResponse>("/api/report-day/history?limit=8")
        .then((data) => setReportHistory(Array.isArray(data?.items) ? data.items : []))
        .catch(() => undefined);
      apiGet<AvailableDatesResponse>("/api/report-day/available-dates?limit=1000")
        .then((data) => {
          lastLoadedDateRef.current = null;
          const dates = Array.isArray(data?.dates) ? data.dates : [];
          setAvailableReportDates(dates);
          missingReportDatesRef.current = new Set(
            [...missingReportDatesRef.current].filter((item) => !dates.includes(item)),
          );
        })
        .catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha não identificada";
      setStatus(`Erro: ${message}`);
      setRawOutput(`Erro: ${message}`);
      pushRunStep(`Parou com erro: ${message}`);
      setRunCurrentContact(null);
      setCurrentRunId(null);
      setRunStartedAt(null);
    } finally {
      setLoading(null);
    }
  }

  const navClass = (section: string) => (activeNav === section ? "active" : "");

  const focusReportByContact = (contactName: string) => {
    const clean = String(contactName || "").trim();
    if (!clean) return;
    setSelectedReportContact(clean);
    navFreezeUntilRef.current = Date.now() + 850;
    activeNavRef.current = "relatorio";
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
    navFreezeUntilRef.current = Date.now() + 850;
    activeNavRef.current = section;
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
    currentRunId,
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
    productDemand,
    operationalAlerts,
    clientAvgResponseMinutes: clientResponseStats.averageMinutesLabel,
    clientPeakHourLabel: clientResponseStats.peakHourLabel,
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




