import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost, ApiRequestError } from "../../../lib/api";
import type {
  AvailableDatesResponse,
  FailureItem,
  InsightItem,
  OverviewPayload,
  ReportByDateResponse,
  ReportHistoryResponse,
  ReportJobStartResponse,
  ReportJobStatusResponse,
  ReportPayload,
  SystemCheckResponse,
} from "../../../types";
import { clampDateInput, normalizeDateInput, toDateInputValue } from "../shared/helpers";
import type {
  ActionKey,
  ApiConfigPayload,
  DashboardController,
  InsightFilter,
  MetricCard,
  PeriodPreset,
  AttendantPerformanceSummary,
} from "../shared/types";
import {
  addDays,
  toTitleCaseName,
  type ReportSeverityFilter,
} from "./controller/common";
import { aggregateSnapshots } from "./controller/periodAggregation";
import type { DashboardRunSnapshot } from "./controller/runSnapshotMapper";
import { mapRunToDashboardSnapshot } from "./controller/runSnapshotMapper";
import { buildAttendantsPerformance } from "./controller/attendantsPerformance";
import {
  buildAllInsights,
  buildFilteredReportMarkdown,
  buildGaugeData,
  buildInformationalInsights,
  buildMetricCards,
  buildPanoramaExtra,
  buildReportContacts,
  buildReportLinks,
  buildRiskRows,
  buildSelectedDateInfo,
  buildSeveritySnapshot,
  buildSortedInsights,
  buildTrendSeries,
  clampInsightsPageSize,
  filterFailuresByContact,
} from "./controller/derived";
import {
  buildClientResponseStats,
  extractOperationalAlerts,
  extractProductDemand,
} from "./controller/operationalSignals";

const SECTION_IDS = ["inicio", "gaps", "insights"] as const;
const NAVBAR_HEIGHT = 68;
const POLL_INTERVAL_MS = 4000;
const BASE_POLL_IDLE_TIMEOUT_MS = 35 * 60 * 1000;
const MAX_POLL_IDLE_TIMEOUT_MS = 90 * 60 * 1000;
const PER_CONTACT_IDLE_TIMEOUT_MS = 30 * 1000;

function getAdaptivePollIdleTimeoutMs(total: number): number {
  const safeTotal = Math.max(0, Number(total || 0));
  const adaptive = BASE_POLL_IDLE_TIMEOUT_MS + safeTotal * PER_CONTACT_IDLE_TIMEOUT_MS;
  return Math.max(BASE_POLL_IDLE_TIMEOUT_MS, Math.min(MAX_POLL_IDLE_TIMEOUT_MS, adaptive));
}

function buildStatusSignature(statusData: ReportJobStatusResponse): string {
  const current = statusData.current_contact;
  return [
    statusData.updated_at || "",
    statusData.phase || "",
    statusData.total || 0,
    statusData.processed || 0,
    statusData.wait_message || "",
    statusData.wait_reason || "",
    statusData.wait_retry_after_ms || 0,
    statusData.wait_attempt || 0,
    current?.sequence || 0,
    current?.contact_key || "",
    current?.analysis_key || "",
  ].join("|");
}

export function useDashboardController(options?: { enabled?: boolean; syncNavOnScroll?: boolean }): DashboardController {
  const enabled = options?.enabled ?? true;
  const syncNavOnScroll = options?.syncNavOnScroll ?? true;
  const SELECTED_DATE_STORAGE_KEY = "hile_selected_date_v1";
  const PROGRESS_STEPS = 6;
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
  const [insightFilter, setInsightFilterState] = useState<InsightFilter>("all");
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
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [reportHistory, setReportHistory] = useState<ReportHistoryResponse["items"]>([]);
  const [availableReportDates, setAvailableReportDates] = useState<string[]>([]);
  const [hasLoadedAvailableDates, setHasLoadedAvailableDates] = useState<boolean>(false);
  const [isLoadingDateReport, setIsLoadingDateReport] = useState<boolean>(false);
  const lastLoadedDateRef = useRef<string | null>(null);
  const latestHistoryRunIdRef = useRef<string | null>(null);
  const missingReportDatesRef = useRef<Set<string>>(new Set());
  const initialReportDateResolvedRef = useRef<boolean>(false);
  const userSelectedDateRef = useRef<boolean>(false);
  const isBusy = loading !== null;
  const isRunningOverview = loading === "overview";
  const insightsPageSize = clampInsightsPageSize();

  function setDate(value: string) {
    const normalized = normalizeDateInput(value, maxDate);
    const safe = clampDateInput(normalized, minDate, maxDate);
    if (safe > maxDate) return;
    userSelectedDateRef.current = true;
    if (
      periodPreset === "week" ||
      periodPreset === "month" ||
      periodPreset === "year" ||
      periodPreset === "total"
    ) {
      setPeriodPreset("today");
    }
    setDateState(safe);
  }

  function setInsightFilter(value: InsightFilter) {
    setInsightFilterState(value);
    setInsightsPage(1);
  }

  const isPeriodMode =
    periodPreset === "week" || periodPreset === "month" || periodPreset === "year" || periodPreset === "total";
  const loadedPeriodDatesRef = useRef<string | null>(null);
  const isLoadingPeriodRef = useRef(false);

  async function loadPeriodData(preset: PeriodPreset, dates: string[], options?: { background?: boolean }) {
    if (isLoadingPeriodRef.current) return;
    const background = options?.background ?? false;

    const now = new Date();
    const toDate = toDateInputValue(now);
    const from = new Date(now);
    if (preset === "week") from.setDate(now.getDate() - 6);
    else if (preset === "month") from.setDate(now.getDate() - 29);
    else if (preset === "year") from.setDate(now.getDate() - 364);
    const fromDate = toDateInputValue(from);

    const datesInRange =
      preset === "total"
        ? [...dates].sort()
        : [...dates]
            .filter((d) => d >= fromDate && d <= toDate)
            .sort();

    if (datesInRange.length === 0) {
      if (!background) {
        setStatus("Nenhum relatório salvo no período selecionado.");
        setOverview(null);
        setInsights([]);
        setReport(null);
        setFailures([]);
        setRawOutput("Sem relatórios no período.");
        setInsightsReady(false);
        setShowTrend(false);
      }
      return;
    }

    const periodKey = `${preset}-${datesInRange.join(",")}`;
    if (loadedPeriodDatesRef.current === periodKey) return;

    isLoadingPeriodRef.current = true;
    if (!background) {
      setStatus(`Agregando dados de ${datesInRange.length} dia(s)...`);
      setOverview(null);
      setInsights([]);
      setReport(null);
      setFailures([]);
      setRawOutput("Carregando dados do período...");
      setInsightsReady(false);
      setShowTrend(false);
    }

    try {
      const promises = datesInRange.map((d) =>
        apiGet<ReportByDateResponse>(`/api/report-day/by-date?date=${encodeURIComponent(d)}`)
          .then((payload) => (payload?.run ? mapRunToDashboardSnapshot(payload.run) : null))
          .catch(() => null),
      );

      const results = (await Promise.all(promises)).filter((r): r is DashboardRunSnapshot => r !== null);

      if (results.length === 0) {
        if (!background) {
          setStatus("Nenhum relatório carregado no período.");
        }
        isLoadingPeriodRef.current = false;
        return;
      }

      loadedPeriodDatesRef.current = periodKey;
      const dateLabel =
        preset === "total"
          ? datesInRange.length > 0
            ? `${datesInRange[0]} a ${datesInRange[datesInRange.length - 1]}`
            : "Total"
          : `${fromDate} a ${toDate}`;
      const aggregated = aggregateSnapshots(results, dateLabel);
      setOverview(aggregated.overview);
      setInsights(aggregated.insights);
      setReport(aggregated.report);
      setFailures(aggregated.report?.raw_analysis?.failures || []);
      setRawOutput(aggregated.rawOutput);
      setInsightsReady(true);
      setShowTrend(true);
      setLastRunAt(new Date().toISOString());
      setStatus(
        background
          ? `Período atualizado automaticamente: ${datesInRange.length} dia(s), ${aggregated.insights.length} contato(s), ${aggregated.overview.overview.critical_insights_count} crítico(s).`
          : `Período agregado: ${datesInRange.length} dia(s), ${aggregated.insights.length} contato(s), ${aggregated.overview.overview.critical_insights_count} crítico(s).`,
      );
    } catch (err) {
      loadedPeriodDatesRef.current = null;
      if (!background) {
        setOverview(null);
        setInsights([]);
        setReport(null);
        setFailures([]);
        setRawOutput("Erro ao agregar período.");
        setInsightsReady(false);
        setShowTrend(false);
        setStatus(`Erro ao carregar período: ${err instanceof Error ? err.message : "Erro desconhecido"}`);
      }
    } finally {
      isLoadingPeriodRef.current = false;
    }
  }

  async function loadSavedDateReport(targetDate: string, options?: { background?: boolean }) {
    const background = options?.background ?? false;

    if (!background) {
      setOverview(null);
      setInsights([]);
      setReport(null);
      setFailures([]);
      setRawOutput("Carregando relatório salvo da data selecionada...");
      setInsightsReady(false);
      setShowTrend(false);
      setIsLoadingDateReport(true);
      setStatus(`Carregando relatório salvo de ${targetDate}...`);
    }

    try {
      const payload = await apiGet<ReportByDateResponse>(`/api/report-day/by-date?date=${encodeURIComponent(targetDate)}`);
      if (!payload?.run) {
        throw new Error("Nenhum relatório salvo encontrado para a data selecionada.");
      }

      const snapshot = mapRunToDashboardSnapshot(payload.run);
      setOverview(snapshot.overview);
      setInsights(snapshot.insights);
      setReport(snapshot.report);
      setFailures([]);
      setRawOutput(snapshot.rawOutput || "Relatório salvo sem conteúdo markdown.");
      setInsightsReady(true);
      setShowTrend(true);
      setLastRunAt(payload.run.started_at || new Date().toISOString());
      setStatus(background ? `Dados atualizados automaticamente para ${targetDate}.` : `Dados carregados para ${targetDate}.`);
      missingReportDatesRef.current.delete(targetDate);
      setAvailableReportDates((current) => (current.includes(targetDate) ? current : [targetDate, ...current]));
      return snapshot;
    } catch (error) {
      const isNotFound = error instanceof ApiRequestError && error.status === 404;
      const message = error instanceof Error ? error.message : "Não foi possível carregar o relatório salvo agora.";

      if (!background) {
        if (isNotFound) {
          missingReportDatesRef.current.add(targetDate);
          setOverview(null);
          setInsights([]);
          setReport(null);
          setFailures([]);
          setRawOutput("Sem relatório salvo para essa data. Você pode gerar um novo overview.");
          setInsightsReady(false);
          setShowTrend(false);
          setStatus(`Não encontramos relatório salvo para ${targetDate}.`);
          setAvailableReportDates((current) =>
            current.includes(targetDate) ? current.filter((item) => item !== targetDate) : current,
          );
        } else {
          lastLoadedDateRef.current = null;
          setStatus(`Não foi possível carregar ${targetDate} agora: ${message}`);
        }
      }
      return null;
    } finally {
      if (!background) {
        setIsLoadingDateReport(false);
      }
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
    let raf = 0;
    let nextDate = maxDate;
    try {
      const savedDate = String(localStorage.getItem(SELECTED_DATE_STORAGE_KEY) || "").trim();
      if (savedDate) {
        const normalized = normalizeDateInput(savedDate, maxDate);
        nextDate = clampDateInput(normalized, minDate, maxDate);
      }
    } catch {
      // noop
    }
    raf = requestAnimationFrame(() => {
      setDateState(nextDate);
      setIsDateHydrated(true);
    });
    return () => cancelAnimationFrame(raf);
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
    activeNavRef.current = activeNav;
  }, [activeNav]);

  useEffect(() => {
    if (!enabled || !syncNavOnScroll) return;
    const handler = () => {
      if (Date.now() < navFreezeUntilRef.current) return;

      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop || 0;
      const viewportHeight = window.innerHeight;
      const viewportBottom = scrollTop + viewportHeight;
      const pageBottom = doc.scrollHeight - 2;

      if (viewportBottom >= pageBottom) {
        if (activeNavRef.current !== "insights") {
          activeNavRef.current = "insights";
          setActiveNav("insights");
        }
        return;
      }

      const probeY = scrollTop + NAVBAR_HEIGHT + 24;
      let chosen: string = "gaps";
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
  }, [enabled, syncNavOnScroll]);

  useEffect(() => {
    if (!enabled) return;
    if (!isDateHydrated) return;
    if (!date) return;
    if (isRunningOverview) return;
    if (!hasLoadedAvailableDates) return;
    if (isPeriodMode) return;

    if (missingReportDatesRef.current.has(date)) {
      setOverview(null);
      setInsights([]);
      setReport(null);
      setFailures([]);
      setRawOutput("Sem relatório salvo para essa data. Você pode gerar um novo overview.");
      setInsightsReady(false);
      setShowTrend(false);
      setStatus(`Não encontramos relatório salvo para ${date}.`);
      return;
    }

    if (lastLoadedDateRef.current === date) return;
    lastLoadedDateRef.current = date;
    void loadSavedDateReport(date);
  }, [date, enabled, hasLoadedAvailableDates, isDateHydrated, isRunningOverview, isPeriodMode]);

  useEffect(() => {
    if (!enabled) return;
    if (!isDateHydrated) return;
    if (!hasLoadedAvailableDates) return;
    if (isRunningOverview) return;
    if (isPeriodMode) return;
    if (initialReportDateResolvedRef.current) return;

    const latestAvailableDate = availableReportDates[0] || null;
    if (!latestAvailableDate) {
      initialReportDateResolvedRef.current = true;
      return;
    }

    if (!userSelectedDateRef.current && latestAvailableDate !== date) {
      lastLoadedDateRef.current = null;
      setDateState(latestAvailableDate);
    }

    initialReportDateResolvedRef.current = true;
  }, [availableReportDates, date, enabled, hasLoadedAvailableDates, isDateHydrated, isPeriodMode, isRunningOverview]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const intervalMs = 60_000;

    const syncLatestReport = async () => {
      if (cancelled) return;
      if (isRunningOverview || isBusy || isLoadingDateReport || isLoadingPeriodRef.current) return;

      try {
        const history = await apiGet<ReportHistoryResponse>("/api/report-day/history?limit=8");
        if (cancelled) return;

        const items = Array.isArray(history?.items) ? history.items : [];
        const latest = items[0] || null;
        if (!latest?.id) return;

        if (latestHistoryRunIdRef.current === latest.id) return;
        latestHistoryRunIdRef.current = latest.id;

        setReportHistory(items);
        setLastRunAt(latest.started_at || latest.finished_at || new Date().toISOString());

        const datesResponse = await apiGet<AvailableDatesResponse>("/api/report-day/available-dates?limit=1000");
        if (cancelled) return;

        const dates = Array.isArray(datesResponse?.dates) ? datesResponse.dates : [];
        setAvailableReportDates(dates);
        missingReportDatesRef.current = new Set(
          [...missingReportDatesRef.current].filter((item) => !dates.includes(item)),
        );
        setHasLoadedAvailableDates(true);

        if (isPeriodMode) {
          loadedPeriodDatesRef.current = null;
          void loadPeriodData(periodPreset, dates, { background: true });
          return;
        }

        const latestAvailableDate = dates[0] || null;
        if (
          latestAvailableDate &&
          !userSelectedDateRef.current &&
          latestAvailableDate !== date &&
          !isRunningOverview
        ) {
          lastLoadedDateRef.current = null;
          setDateState(latestAvailableDate);
          return;
        }

        if (String(latest.date_ref || "").trim() === date) {
          lastLoadedDateRef.current = null;
          void loadSavedDateReport(date, { background: true });
        }
      } catch {
        // refresh silencioso
      }
    };

    const timer = window.setInterval(() => {
      void syncLatestReport();
    }, intervalMs);

    void syncLatestReport();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [date, enabled, isBusy, isLoadingDateReport, isPeriodMode, isRunningOverview, periodPreset]);

  const informationalInsights = useMemo(() => {
    return buildInformationalInsights(report, insights);
  }, [insights, report]);

  const sortedInsights = useMemo(() => {
    return buildSortedInsights(insights);
  }, [insights]);

  const allInsights = useMemo(() => {
    return buildAllInsights(insights);
  }, [insights]);

  const improvementInsights = useMemo(() => {
    return sortedInsights.filter(
      (insight) => insight.severity === "medium" || insight.severity === "low",
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
    return buildSeveritySnapshot(sortedInsights);
  }, [sortedInsights]);

  const trendSeries = useMemo(() => {
    return buildTrendSeries(overview, report);
  }, [overview, report]);

  const metricCards = useMemo<MetricCard[]>(() => {
    return buildMetricCards(overview);
  }, [overview]);

  const gaugeData = useMemo(() => {
    return buildGaugeData(severitySnapshot);
  }, [severitySnapshot]);

  const panoramaExtra = useMemo(() => {
    return buildPanoramaExtra(overview);
  }, [overview]);

  const riskRows = useMemo(() => {
    return buildRiskRows(severitySnapshot);
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

  const attendantsPerformance = useMemo<AttendantPerformanceSummary>(() => {
    return buildAttendantsPerformance(report);
  }, [report]);

  const selectedDateHasSavedReport = useMemo(() => {
    const loadedReportDate = String(report?.date || "").trim();
    return availableReportDates.includes(date) || loadedReportDate === date;
  }, [availableReportDates, date, report?.date]);

  const selectedDateInfo = useMemo(() => {
    return buildSelectedDateInfo({
      date,
      maxDate,
      isLoadingDateReport,
      periodPreset,
      selectedDateHasSavedReport,
    });
  }, [date, isLoadingDateReport, maxDate, periodPreset, selectedDateHasSavedReport]);

  const reportContacts = useMemo(() => {
    return buildReportContacts(report);
  }, [report]);

  const filteredFailures = useMemo(() => {
    return filterFailuresByContact(failures, selectedReportContact);
  }, [failures, selectedReportContact]);

  const filteredReportMarkdown = useMemo(() => {
    return buildFilteredReportMarkdown(report, selectedReportContact, reportSeverityFilter);
  }, [report, selectedReportContact, reportSeverityFilter]);

  const reportLinks = useMemo(() => {
    return buildReportLinks({
      report,
      selectedReportContact,
      chatwootBaseUrl: apiConfig?.chatwoot_base_url || "",
    });
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

    const previousDashboardState = {
      overview,
      insights,
      report,
      failures,
      rawOutput,
      insightsReady,
      showTrend,
      lastRunAt,
      selectedReportContact,
      reportSeverityFilter,
    };

    setLoading("overview");
    setRunTimeline(["Iniciando overview do dia..."]);
    updateRunProgress(1);
    setRunCurrentContact(null);
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
        let finalStatus: ReportJobStatusResponse | null = null;
        let lastProcessed = -1;
        let lastCurrentContactKey = "";
        let lastHeartbeatAt = Date.now();
        let lastHeartbeatSignature = "";
        let pollFailureCount = 0;
        let idleTimeoutMs = BASE_POLL_IDLE_TIMEOUT_MS;

        while (true) {
          await sleep(POLL_INTERVAL_MS);
          const runIdQuery = reportJob.db_run_id ? `&run_id=${encodeURIComponent(reportJob.db_run_id)}` : "";
          let statusData: ReportJobStatusResponse;
          try {
            statusData = await apiGet<ReportJobStatusResponse>(
              `/api/report-day/status?job_id=${encodeURIComponent(reportJob.job_id)}${runIdQuery}`,
            );
            pollFailureCount = 0;
          } catch (error) {
            pollFailureCount += 1;
            pushRunStep(`Acompanhando o status... tentativa ${pollFailureCount} com falha temporária.`);
            if (pollFailureCount < 3) {
              continue;
            }
            throw new Error(error instanceof Error ? error.message : "Falha ao consultar o status do relatório.");
          }

          finalStatus = statusData;
          const heartbeatSignature = buildStatusSignature(statusData);
          if (heartbeatSignature !== lastHeartbeatSignature) {
            lastHeartbeatSignature = heartbeatSignature;
            lastHeartbeatAt = Date.now();
            idleTimeoutMs = getAdaptivePollIdleTimeoutMs(statusData.total || 0);
          }

          const total = Math.max(0, Number(statusData.total || 0));
          const processed = Math.max(0, Number(statusData.processed || 0));
          const isWaiting = statusData.phase === "waiting";
          const isFinalizing = statusData.phase === "finalizing" || (statusData.status === "running" && total > 0 && processed >= total);

          if (isWaiting) {
            const current = statusData.current_contact;
            const safeTotal = current?.total || total || 0;
            const formattedCurrentName = current ? toTitleCaseName(current.contact_name || "") : "";
            const displayName =
              formattedCurrentName ||
              String(current?.contact_key || "").trim() ||
              "Contato";
            const waitMessage =
              statusData.wait_message ||
              `Aguardando liberação de quota do Dify/OpenAI${displayName ? ` para ${displayName}` : ""}.`;
            const waitSignature = `waiting-${statusData.wait_attempt || 0}-${statusData.wait_message || waitMessage}`;
            setRunCurrentContact(
              current
                ? `${displayName} (${current.sequence}/${safeTotal > 0 ? safeTotal : "?"}) - aguardando`
                : waitMessage,
            );
            setStatus(waitMessage);
            if (waitSignature !== lastCurrentContactKey) {
              lastCurrentContactKey = waitSignature;
              pushRunStep(waitMessage);
            }
          } else if (isFinalizing) {
            if (lastCurrentContactKey !== "finalizing") {
              lastCurrentContactKey = "finalizing";
              pushRunStep("Processamento concluído. Finalizando persistência e atualização do histórico...");
            }
            setRunCurrentContact("Finalizando persistência...");
            setStatus("Finalizando persistência e atualização do histórico...");
          } else if (statusData.current_contact) {
            const current = statusData.current_contact;
            const safeTotal = current.total || total || 0;
            const signature = `${current.contact_key}-${current.sequence}-${safeTotal}`;
            const formattedCurrentName = toTitleCaseName(current.contact_name || "");
            const displayName =
              formattedCurrentName ||
              String(current.contact_key || "").trim() ||
              "Contato";
            setRunCurrentContact(
              `${displayName} (${current.sequence}/${safeTotal > 0 ? safeTotal : "?"})`,
            );
            setStatus(`Analisando ${displayName} (${current.sequence}/${safeTotal > 0 ? safeTotal : "?"})...`);
            if (signature !== lastCurrentContactKey) {
              lastCurrentContactKey = signature;
              pushRunStep(
                `Analisando contato ${current.sequence}/${safeTotal > 0 ? safeTotal : "?"}: ${displayName} (${current.contact_key}).`,
              );
            }
          } else {
            setRunCurrentContact(null);
            setStatus("Processando overview...");
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

          if (Date.now() - lastHeartbeatAt > idleTimeoutMs) {
            throw new Error("A execução ficou sem heartbeat por tempo demais. Verifique os logs.");
          }
        }

        if (!finalStatus || finalStatus.status !== "completed") {
          throw new Error("A execução não concluiu dentro do acompanhamento esperado.");
        }

        let reportData: ReportPayload | null = finalStatus.result as ReportPayload | null;
        let persistedByDate: ReportByDateResponse | null = null;
        const expectedRunId = finalStatus.db_run_id || reportJob.db_run_id || null;
        pushRunStep("Execução concluída. Exibindo o resultado imediato e renovando o histórico em segundo plano...");
        const syncAttempts = 0; // background-only: avoid blocking on by-date confirmation
        for (let attempt = 0; attempt < syncAttempts; attempt += 1) {
          try {
            const payload = await apiGet<ReportByDateResponse>(
              `/api/report-day/by-date?date=${encodeURIComponent(safeDate)}`,
            );
            const sameRun = expectedRunId ? payload?.run?.id === expectedRunId : Boolean(payload?.run);
            if (payload?.run && sameRun) {
              persistedByDate = payload;
              break;
            }
          } catch {
            // tenta novamente
          }
          await sleep(400);
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
          finalOverviewData = {
            date: reportData.date || safeDate,
            timezone: "America/Fortaleza",
            generated_at: new Date().toISOString(),
            account: {
              id: Number(reportData.account?.id || 0),
              name: reportData.account?.name || null,
              role: reportData.account?.role || null,
            },
            inbox: {
              id: Number(reportData.inbox?.id || 0),
              name: reportData.inbox?.name || null,
              provider: reportData.inbox?.provider || null,
              channel_type: reportData.inbox?.channel_type || null,
              phone_number: reportData.inbox?.phone_number || null,
            },
            overview: {
              conversations_scanned: Number(reportData.summary?.total_to_process || 0),
              conversations_entered_today: Number(reportData.summary?.conversations_entered_today || 0),
              unique_contacts_today: Number(reportData.summary?.unique_contacts_today || 0),
              conversations_total_analyzed_day: Number(reportData.summary?.processed || 0),
              total_analysis_count: Number(reportData.summary?.analyses_count || 0),
              total_messages_day: 0,
              repeated_identifier_count: 0,
              finalized_count: 0,
              continued_count: 0,
              trigger_ready_count: 0,
              critical_insights_count: Number(reportData.summary?.critical_count || 0),
              non_critical_insights_count: 0,
              insights_total: 0,
            },
            insights: [],
            conversation_operational: [],
          };
          finalInsights = [];
          finalReportData = reportData;
          finalFailures = reportData.raw_analysis?.failures || [];
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
        setOverview(previousDashboardState.overview);
        setInsights(previousDashboardState.insights);
        setReport(previousDashboardState.report);
        setFailures(previousDashboardState.failures);
        setRawOutput(previousDashboardState.rawOutput);
        setInsightsReady(previousDashboardState.insightsReady);
        setShowTrend(previousDashboardState.showTrend);
        setLastRunAt(previousDashboardState.lastRunAt);
        setSelectedReportContact(previousDashboardState.selectedReportContact);
        setReportSeverityFilter(previousDashboardState.reportSeverityFilter);
        setStatus(`Nova execução falhou em ${elapsed}s. Mantivemos os dados anteriores: ${reportFailedMessage}`);
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
        setStatus(`Overview concluido em ${elapsed}s. Conexoes ${check.ok ? "OK" : "com alerta"}.`);
      }
      pushRunStep(`Overview finalizado em ${elapsed}s.`);
      setRunProgress(100);
      setCurrentRunId(null);
      apiGet<ReportHistoryResponse>("/api/report-day/history?limit=8")
        .then((data) => {
          const items = Array.isArray(data?.items) ? data.items : [];
          setReportHistory(items);
          latestHistoryRunIdRef.current = items[0]?.id || latestHistoryRunIdRef.current;
        })
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
      const message = error instanceof Error ? error.message : "Falha nao identificada";
      setOverview(previousDashboardState.overview);
      setInsights(previousDashboardState.insights);
      setReport(previousDashboardState.report);
      setFailures(previousDashboardState.failures);
      setRawOutput(previousDashboardState.rawOutput);
      setInsightsReady(previousDashboardState.insightsReady);
      setShowTrend(previousDashboardState.showTrend);
      setLastRunAt(previousDashboardState.lastRunAt);
      setSelectedReportContact(previousDashboardState.selectedReportContact);
      setReportSeverityFilter(previousDashboardState.reportSeverityFilter);
      setStatus(`Erro: ${message}`);
      pushRunStep(`Parou com erro: ${message}`);
      setRunCurrentContact(null);
      setCurrentRunId(null);
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
    activeNavRef.current = "insights";
    setActiveNav("insights");
    const target = document.getElementById("insights");
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
    allInsights,
    informationalInsights,
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
    attendantsPerformance,
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














