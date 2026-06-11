import { Fragment, useMemo } from "react";
import type { OverviewPayload, Severity } from "../../../../types";
import type { PeriodPreset } from "../../shared/types";
import { summarizeStatusMessage } from "../../shared/helpers";
import {
  HileCardGrid,
  HileInlineInsight,
  HileKpiCard,
  HileSectionShell,
  HileSurfaceCard,
} from "../../shared/ui/HilePrimitives";

interface MetricsSectionProps {
  date: string;
  setDate: (value: string) => void;
  minDate: string;
  maxDate: string;
  periodPreset: PeriodPreset;
  applyPeriodPreset: (value: PeriodPreset) => void;
  isBusy: boolean;
  isRunningOverview: boolean;
  onRequestOverview: () => void;
  onOpenLogs: () => void;
  overview: OverviewPayload | null;
  severitySnapshot: Record<Severity, number>;
  runProgress: number;
  runCurrentContact: string | null;
  runTimeline: string[];
  selectedDateInfo: string;
  selectedDateHasSavedReport: boolean;
  clientAvgResponseMinutes: string;
  clientPeakHourLabel: string;
  currentStatus: string;
}

const PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "before_yesterday", label: "Anteontem" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mês" },
  { key: "year", label: "Ano" },
  { key: "total", label: "Total" },
];

function getRelativePreset(date: string): PeriodPreset | null {
  const now = new Date();
  const toYmd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = toYmd(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const beforeYesterday = new Date(now);
  beforeYesterday.setDate(now.getDate() - 2);
  if (date === today) return "today";
  if (date === toYmd(yesterday)) return "yesterday";
  if (date === toYmd(beforeYesterday)) return "before_yesterday";
  return null;
}

function formatPeriodLabel(preset: PeriodPreset, date?: string): string {
  if (date && (preset === "today" || preset === "yesterday" || preset === "before_yesterday")) {
    const now = new Date();
    const toYmd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today = toYmd(now);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const beforeYesterday = new Date(now);
    beforeYesterday.setDate(now.getDate() - 2);
    if (date === today) return "Hoje";
    if (date === toYmd(yesterday)) return "Ontem";
    if (date === toYmd(beforeYesterday)) return "Anteontem";
    return "Dia personalizado";
  }

  const map: Record<PeriodPreset, string> = {
    today: "Hoje",
    yesterday: "Ontem",
    before_yesterday: "Anteontem",
    week: "Semana",
    month: "Mês",
    year: "Ano",
    total: "Total",
  };
  return map[preset];
}

function formatDateBr(input: string): string {
  const [year, month, day] = input.split("-").map(Number);
  if (!year || !month || !day) return input;
  const value = new Date(year, month - 1, day);
  return value.toLocaleDateString("pt-BR");
}

export function MetricsSection({
  date,
  setDate,
  minDate,
  maxDate,
  periodPreset,
  applyPeriodPreset,
  isBusy,
  isRunningOverview,
  onRequestOverview,
  onOpenLogs,
  overview,
  severitySnapshot,
  runProgress,
  runCurrentContact,
  runTimeline,
  selectedDateInfo,
  selectedDateHasSavedReport,
  clientAvgResponseMinutes,
  clientPeakHourLabel,
  currentStatus,
}: MetricsSectionProps) {
  const summary = overview?.overview;
  const hasOverviewData = Boolean(summary);

  const kpis = useMemo(() => {
    const totalConversations = summary?.conversations_total_analyzed_day ?? 0;
    const critical = severitySnapshot.critical || 0;
    const high = severitySnapshot.high || 0;
    const medium = severitySnapshot.medium || 0;
    const low = severitySnapshot.low || 0;
    const criticalAndHigh = critical + high;
    const withoutGaps = Math.max(0, totalConversations - (critical + high + medium + low));

    return {
      totalConversations,
      totalMessages: summary?.total_messages_day ?? 0,
      critical,
      high,
      medium,
      low,
      criticalAndHigh,
      withoutGaps,
      finalized: summary?.finalized_count ?? 0,
      repeatedContacts: summary?.repeated_identifier_count ?? 0,
      open: summary?.continued_count ?? 0,
      triggers: summary?.trigger_ready_count ?? 0,
    };
  }, [severitySnapshot.critical, severitySnapshot.high, severitySnapshot.medium, severitySnapshot.low, summary]);

  const panorama = useMemo(() => {
    const safeConversations = Math.max(1, summary?.conversations_total_analyzed_day ?? 0);
    const totalMessages = summary?.total_messages_day ?? 0;
    const avgMessages = totalMessages / safeConversations;
    const finalizationRate = (kpis.finalized / safeConversations) * 100;
    const criticalityRate = (kpis.criticalAndHigh / safeConversations) * 100;

    return {
      avgMessages: Number.isFinite(avgMessages) ? avgMessages.toFixed(1) : "0.0",
      finalizationRate: `${Math.max(0, Math.min(100, Math.round(finalizationRate)))}%`,
      criticalityRate: `${Math.max(0, Math.min(100, Math.round(criticalityRate)))}%`,
      waitingOnIa: `${kpis.triggers}`,
    };
  }, [kpis.criticalAndHigh, kpis.finalized, kpis.triggers, summary?.conversations_total_analyzed_day, summary?.total_messages_day]);

  const relativePreset = useMemo(() => getRelativePreset(date), [date]);
  const isAggregateMode =
    periodPreset === "week" || periodPreset === "month" || periodPreset === "year" || periodPreset === "total";
  const isCustomDay = !isAggregateMode && relativePreset === null;

  const statusText = currentStatus.trim();
  const statusFallback = "Sem execução no momento";
  const statusSummary = summarizeStatusMessage(statusText || statusFallback);
  const statusTooltip = statusText || statusFallback;
  const normalizedStatus = statusText.toLowerCase();
  const statusTone =
    normalizedStatus.includes("falhou") || normalizedStatus.includes("erro")
      ? "critical"
      : normalizedStatus.includes("conclu")
        ? "warning"
        : "default";

  return (
    <div className="section reveal" id="inicio">
      <div className="section-inner">
        <HileSectionShell
          eyebrow="01"
          title={isAggregateMode ? "Métricas do Período" : "Métricas do Dia"}
          description={`Período: ${formatPeriodLabel(periodPreset, date)} — ${formatDateBr(date)}`}
        >
          <div className="hile-section-stack">
            <HileSurfaceCard
              title="Controles do período"
              description="Selecione o recorte, confira o status do relatório salvo e execute um novo overview quando quiser atualizar o consolidado."
              tone="accent"
            >
              <div className="orq-row orq-row-period">
                <label>Período</label>
                <div className="filter-box" style={{ flex: 1 }}>
                  <div className="filter-group" style={{ flex: 1 }}>
                    {PRESETS.map((preset, index) => (
                      <Fragment key={preset.key}>
                        {index === 3 ? <div className="filter-sep" /> : null}
                        <button
                          type="button"
                          className={`filter-pill ${
                            periodPreset === preset.key &&
                            (preset.key === "week" ||
                              preset.key === "month" ||
                              preset.key === "year" ||
                              preset.key === "total" ||
                              relativePreset === preset.key)
                              ? "active"
                              : ""
                          }`}
                          onClick={() => applyPeriodPreset(preset.key)}
                        >
                          {preset.label}
                        </button>
                      </Fragment>
                    ))}
                    {isCustomDay ? (
                      <>
                        <div className="filter-sep" />
                        <button type="button" className="filter-pill active" disabled aria-current="true">
                          Dia personalizado
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="orq-row orq-row-exec">
                <label>Execução</label>
                <div className="orq-exec-stack">
                  <div className="filter-box orq-exec-main">
                    <input
                      id="ref-date"
                      type="date"
                      value={date}
                      min={minDate}
                      max={maxDate}
                      onChange={(event) => setDate(event.target.value)}
                    />
                    <span className={`status-badge ${selectedDateHasSavedReport ? "ok" : "orq-warning"}`}>
                      {selectedDateHasSavedReport ? "Com relatório" : "Sem relatório"}
                    </span>
                  </div>

                  <div className="filter-box orq-exec-actions">
                    <div className="filter-group orq-exec-mode-group">
                      <button className="btn btn-primary orq-run-btn" onClick={onRequestOverview} disabled={isBusy}>
                        {isRunningOverview ? "Processando..." : "Executar Overview"}
                      </button>
                      <span className="orq-inline-note">{selectedDateInfo}</span>
                    </div>
                  </div>

                  {isRunningOverview ? (
                    <div className="filter-box orq-progress-box">
                      <div className="orq-progress-head">
                        <strong>{runCurrentContact ? `Analisando: ${runCurrentContact}` : "Processando overview"}</strong>
                        <span>{runProgress}%</span>
                      </div>
                      <div className="orq-progress-track" role="progressbar" aria-valuenow={runProgress} aria-valuemin={0} aria-valuemax={100}>
                        <div className="orq-progress-fill" style={{ width: `${runProgress}%` }} />
                      </div>
                      <div className="orq-progress-meta">
                        <span>{runTimeline.length ? runTimeline[runTimeline.length - 1] : "Executando..."}</span>
                        <button type="button" className="link-btn" onClick={onOpenLogs}>
                          Acompanhar detalhes em Logs
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="hile-section-stack">
                      {statusText ? (
                        <HileInlineInsight title="Última execução" tone={statusTone}>
                          <span className="hile-status-summary" title={statusTooltip}>
                            {statusSummary}
                          </span>
                        </HileInlineInsight>
                      ) : null}
                      <HileInlineInsight title="Acompanhamento" tone="default">
                        Se quiser acompanhar o processo detalhado da execução, abra a seção{" "}
                        <button type="button" className="link-btn" onClick={onOpenLogs}>
                          Logs
                        </button>
                        .
                      </HileInlineInsight>
                    </div>
                  )}
                </div>
              </div>
            </HileSurfaceCard>

            <div className={!hasOverviewData ? "data-dim" : ""}>
              <HileCardGrid cols={4}>
                <HileKpiCard label="Conversas totais" value={kpis.totalConversations} hint="analisadas no período" />
                <HileKpiCard label="Gaps críticos" value={kpis.critical} hint="severidade crítica" tone="critical" accent="critical" />
                <HileKpiCard label="Gaps altos" value={kpis.high} hint="severidade alta" tone="critical" accent="high" />
                <HileKpiCard label="Gaps médios" value={kpis.medium} hint="severidade média" />
                <HileKpiCard label="Gaps baixos" value={kpis.low} hint="severidade baixa" tone="success" accent="success" />
                <HileKpiCard label="Sem gaps" value={kpis.withoutGaps} hint="sem risco operacional" tone="accent" accent="accent" />
                <HileKpiCard label="Finalizadas" value={kpis.finalized} hint="com etiqueta" tone="success" accent="success" />
                <HileKpiCard label="Gatilhos" value={kpis.triggers} hint="+1h sem resposta" />
              </HileCardGrid>
            </div>

            <div className={!hasOverviewData ? "data-dim" : ""}>
              <HileSurfaceCard
                title="Panorama do dia"
                description="Leitura rápida de finalização, criticidade e comportamento do atendimento no recorte selecionado."
                tone="soft"
              >
                <HileCardGrid cols={4}>
                  <HileKpiCard label="Média de mensagens por conversa" value={panorama.avgMessages} />
                  <HileKpiCard label="Taxa de finalização" value={panorama.finalizationRate} accent="success" />
                  <HileKpiCard label="Taxa de gaps críticos + altos" value={panorama.criticalityRate} accent="critical" />
                  <HileKpiCard label="Conversas aguardando IA (+1h)" value={panorama.waitingOnIa} />
                  <HileKpiCard label="Mensagens IA + usuário" value={kpis.totalMessages} />
                  <HileKpiCard label="Tempo médio de resposta do cliente" value={clientAvgResponseMinutes} />
                  <HileKpiCard label="Hora de pico de resposta do cliente" value={clientPeakHourLabel} />
                  <HileKpiCard label="Identificadores repetidos" value={kpis.repeatedContacts} hint="CNPJ, e-mail ou telefone reutilizado" />
                </HileCardGrid>
              </HileSurfaceCard>
            </div>
          </div>
        </HileSectionShell>
      </div>
    </div>
  );
}
