import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
import type {
  FailureItem,
  InsightItem,
  OverviewPayload,
  PreviewPayload,
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

function filterReportMarkdownByContact(markdown: string, contactName: string | null): string {
  if (!contactName) return markdown;

  const target = contactName.toLowerCase();
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let sectionBuffer: string[] = [];

  function flushSection() {
    if (!sectionBuffer.length) return;
    const content = sectionBuffer.join("\n").toLowerCase();
    if (content.includes(target)) {
      output.push(...sectionBuffer);
    }
    sectionBuffer = [];
  }

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      flushSection();
      sectionBuffer = [line];
      continue;
    }

    if (sectionBuffer.length) {
      sectionBuffer.push(line);
      continue;
    }

    output.push(line);
  }

  flushSection();
  return output.join("\n").trim();
}

function filterReportMarkdownBySeverity(
  markdown: string,
  severity: "all" | "critical" | "high" | "medium" | "low",
): string {
  if (severity === "all") return markdown;

  const tokenBySeverity: Record<"critical" | "high" | "medium" | "low", string[]> = {
    critical: ["**Severidade:** Crítico", "- **Risco crítico:** Sim"],
    high: ["**Severidade:** Alta"],
    medium: ["**Severidade:** Média"],
    low: ["**Severidade:** Baixa", "- **Risco crítico:** Não"],
  };

  const tokens = tokenBySeverity[severity];
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let sectionBuffer: string[] = [];

  function flushSection() {
    if (!sectionBuffer.length) return;
    const section = sectionBuffer.join("\n");
    if (tokens.some((token) => section.includes(token))) {
      output.push(...sectionBuffer);
    }
    sectionBuffer = [];
  }

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      flushSection();
      sectionBuffer = [line];
      continue;
    }

    if (sectionBuffer.length) {
      sectionBuffer.push(line);
      continue;
    }

    output.push(line);
  }

  flushSection();
  return output.join("\n").trim();
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
  const [reportSeverityFilter, setReportSeverityFilter] = useState<"all" | "critical" | "high" | "medium" | "low">(
    "all",
  );
  const [runTimeline, setRunTimeline] = useState<string[]>([
    "Escolha a data e clique em 'Rodar overview do dia'.",
  ]);
  const [runProgress, setRunProgress] = useState<number>(0);
  const [runCurrentContact, setRunCurrentContact] = useState<string | null>(null);
  const isBusy = loading !== null;
  const isRunningOverview = loading === "overview";
  const insightsPageSize = INSIGHTS_COLLAPSED_LIMIT;

  function setDate(value: string) {
    const normalized = normalizeDateInput(value, maxDate);
    const safe = clampDateInput(normalized, minDate, maxDate);
    setDateState(safe);
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

    // Sem endpoint agregado ainda: usamos dia de referência para semana/mês/ano.
    setDate(toDateInputValue(now));
  }

  useEffect(() => {
    apiGet<ApiConfigPayload>("/api/config")
      .then((data) => setApiConfig(data))
      .catch(() => setApiConfig(null));
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

  const sortedInsights = useMemo(() => {
    return [...insights].sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);
  }, [insights]);

  const filteredInsights = useMemo(() => {
    if (insightFilter === "all") return sortedInsights;
    return sortedInsights.filter((insight) => insight.severity === insightFilter);
  }, [insightFilter, sortedInsights]);

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
    if (!report?.report_markdown) return "";
    const byContact = filterReportMarkdownByContact(report.report_markdown, selectedReportContact);
    const filtered = filterReportMarkdownBySeverity(byContact, reportSeverityFilter);
    if (filtered.trim()) return filtered;
    if (selectedReportContact || reportSeverityFilter !== "all") {
      const contactPart = selectedReportContact ? `contato "${selectedReportContact}"` : "contato";
      const sevPart = reportSeverityFilter !== "all" ? ` e severidade "${reportSeverityFilter}"` : "";
      return `Nenhum trecho do relatório foi encontrado para ${contactPart}${sevPart}.`;
    }
    return report.report_markdown;
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

      setOverview(overviewData);
      setInsights(overviewData.insights || []);
      setFailures([]);
      setShowTrend(true);
      setInsightsReady(true);
      setInsightFilter("all");
      setInsightsPage(1);
      setLastRunAt(new Date().toISOString());
      setOverviewRunCount((value) => value + 1);
      setSelectedReportContact(null);
      setReportSeverityFilter("all");

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
        setReport(reportData);
        setFailures(reportData.raw_analysis?.failures || []);
        setRawOutput(reportData.report_markdown || JSON.stringify(reportData, null, 2));
        pushRunStep("Relatório final gerado com sucesso.");
        setRunCurrentContact(null);
      } catch (reportError) {
        const reportMessage = reportError instanceof Error ? reportError.message : "Erro ao gerar relatório";
        reportFailedMessage = reportMessage;
        setReport(null);
        setRawOutput(JSON.stringify({ system_check: check, overview: overviewData, report_error: reportMessage }, null, 2));
        pushRunStep(`Não conseguimos gerar o relatório: ${reportMessage}`);
        setRunCurrentContact(null);
      }

      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      if (reportFailedMessage) {
        setStatus(`Overview concluído em ${elapsed}s. Relatório falhou: ${reportFailedMessage}`);
      } else {
        setStatus(`Overview concluído em ${elapsed}s. Conexões ${check.ok ? "OK" : "com alerta"}.`);
      }
      pushRunStep(`Overview finalizado em ${elapsed}s.`);
      updateRunProgress(6);
      setRunTimeline([]);
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
    focusReportByContact,
  };
}


