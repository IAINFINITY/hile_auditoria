import { Fragment, useMemo } from "react";
import type { OverviewPayload, Severity } from "../../../types";
import type { PeriodPreset } from "../shared/types";

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
}

const PRESETS: Array<{ key: PeriodPreset; label: string }> = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "before_yesterday", label: "Anteontem" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mês" },
  { key: "year", label: "Ano" },
];

function formatPeriodLabel(preset: PeriodPreset): string {
  const map: Record<PeriodPreset, string> = {
    today: "Hoje",
    yesterday: "Ontem",
    before_yesterday: "Anteontem",
    week: "Semana",
    month: "Mês",
    year: "Ano",
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
}: MetricsSectionProps) {
  const summary = overview?.overview;
  const hasOverviewData = Boolean(summary);

  const kpis = useMemo(() => {
    const criticalAndHigh = (severitySnapshot.critical || 0) + (severitySnapshot.high || 0);
    return {
      mensagensHoje: summary?.total_messages_day ?? 0,
      totalConversas: summary?.conversations_total_analyzed_day ?? 0,
      gapsCriticosAltos: criticalAndHigh,
      finalizadas: summary?.finalized_count ?? 0,
      numerosRepetidos: summary?.repeated_identifier_count ?? 0,
      abertas: summary?.continued_count ?? 0,
      gatilhos: summary?.trigger_ready_count ?? 0,
    };
  }, [severitySnapshot.critical, severitySnapshot.high, summary]);

  const panorama = useMemo(() => {
    const totalConv = Math.max(1, summary?.conversations_total_analyzed_day ?? 0);
    const totalMsgs = summary?.total_messages_day ?? 0;
    const mediaMensagens = totalMsgs / totalConv;
    const taxaFinalizacao = (kpis.finalizadas / totalConv) * 100;
    const taxaCriticidade = (kpis.gapsCriticosAltos / totalConv) * 100;

    return {
      mediaMensagens: Number.isFinite(mediaMensagens) ? mediaMensagens.toFixed(1) : "0.0",
      taxaFinalizacao: `${Math.max(0, Math.min(100, Math.round(taxaFinalizacao)))}%`,
      taxaCriticidade: `${Math.max(0, Math.min(100, Math.round(taxaCriticidade)))}%`,
      aguardandoIa: `${kpis.gatilhos}`,
    };
  }, [kpis.finalizadas, kpis.gapsCriticosAltos, kpis.gatilhos, summary?.conversations_total_analyzed_day, summary?.total_messages_day]);

  return (
    <div className="section reveal" id="inicio">
      <div className="section-inner">
        <div className="section-header">
          <span className="section-num">01</span>
          <div className="section-title">
            <h2>Métricas do Dia</h2>
            <p>Período: {formatPeriodLabel(periodPreset)} — {formatDateBr(date)}</p>
          </div>
        </div>

        <div className="metrics-block">
          <div className="metrics-block-header">
            <span>Controles do período</span>
          </div>
          <div className="metrics-block-body">
            <div className="orq-row orq-row-period">
              <label>Período</label>
              <div className="filter-box" style={{ flex: 1 }}>
                <div className="filter-group" style={{ flex: 1 }}>
                  {PRESETS.map((preset, index) => (
                    <Fragment key={preset.key}>
                      {index === 3 ? <div className="filter-sep" /> : null}
                      <button
                        type="button"
                        className={`filter-pill ${periodPreset === preset.key ? "active" : ""}`}
                        onClick={() => applyPeriodPreset(preset.key)}
                      >
                        {preset.label}
                      </button>
                    </Fragment>
                  ))}
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
                  <div className="orq-hint-box">
                    Se quiser acompanhar o processo detalhado da execução, abra a seção{" "}
                    <button type="button" className="link-btn" onClick={onOpenLogs}>
                      Logs
                    </button>
                    .
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={`metrics-block ${hasOverviewData ? "" : "data-dim"}`}>
          <div className="metrics-block-header">
            <span>Indicadores do período</span>
          </div>
          <div className="metrics-block-body" style={{ padding: 0 }}>
            <div className="kpi-grid">
              <div className="kpi-card"><div className="kpi-label">Mensagens</div><div className="kpi-value">{kpis.mensagensHoje}</div><div className="kpi-sub">IA + usuário</div></div>
              <div className="kpi-card"><div className="kpi-label">Conversas</div><div className="kpi-value">{kpis.totalConversas}</div><div className="kpi-sub">total</div></div>
              <div className="kpi-card"><div className="kpi-label">Gaps</div><div className="kpi-value gap-val">{kpis.gapsCriticosAltos}</div><div className="kpi-sub">críticos + altos</div></div>
              <div className="kpi-card"><div className="kpi-label">Finalizadas</div><div className="kpi-value pos-val">{kpis.finalizadas}</div><div className="kpi-sub">com etiqueta</div></div>
              <div className="kpi-card"><div className="kpi-label">Repetidos</div><div className="kpi-value alert-val">{kpis.numerosRepetidos}</div><div className="kpi-sub">números</div></div>
              <div className="kpi-card"><div className="kpi-label">Abertas</div><div className="kpi-value">{kpis.abertas}</div><div className="kpi-sub">ainda ativas</div></div>
              <div className="kpi-card"><div className="kpi-label">Gatilhos</div><div className="kpi-value">{kpis.gatilhos}</div><div className="kpi-sub">+1h sem resposta</div></div>
            </div>
          </div>
        </div>

        <div className={`metrics-block ${hasOverviewData ? "" : "data-dim"}`}>
          <div className="metrics-block-header">
            <span>Panorama do dia</span>
          </div>
          <div className="metrics-block-body">
            <div className="panorama-grid">
              <div className="pano-card">
                <div className="pano-label">Média de mensagens por conversa</div>
                <div className="pano-value">{panorama.mediaMensagens}</div>
              </div>
              <div className="pano-card">
                <div className="pano-label">Taxa de finalização</div>
                <div className="pano-value pano-pos">{panorama.taxaFinalizacao}</div>
              </div>
              <div className="pano-card">
                <div className="pano-label">Taxa de gaps críticos + altos</div>
                <div className="pano-value gap-val">{panorama.taxaCriticidade}</div>
              </div>
              <div className="pano-card">
                <div className="pano-label">Conversas aguardando IA (+1h)</div>
                <div className="pano-value">{panorama.aguardandoIa}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
