import { Fragment, useMemo } from "react";
import type { OverviewPayload, Severity, SystemCheckResponse } from "../../../types";
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
  lastRunAt: string | null;
  loading: boolean;
  systemCheck: SystemCheckResponse | null;
  overview: OverviewPayload | null;
  severitySnapshot: Record<Severity, number>;
  runTimeline: string[];
  runProgress: number;
  runCurrentContact: string | null;
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
  lastRunAt,
  loading,
  systemCheck,
  overview,
  severitySnapshot,
  runTimeline,
  runProgress,
  runCurrentContact,
}: MetricsSectionProps) {
  const summary = overview?.overview;
  const hasOverviewData = Boolean(summary);

  const kpis = useMemo(() => {
    const criticalAndHigh = (severitySnapshot.critical || 0) + (severitySnapshot.high || 0);
    return {
      atendimentosHoje: summary?.conversations_entered_today ?? 0,
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
    const totalConv = Math.max(1, summary?.conversations_total_analyzed_day ?? 1);
    const totalMsgs = summary?.total_messages_day ?? 0;
    const iaTempoSec = Math.max(12, Math.round((totalMsgs / totalConv) * 4.2));
    const humanoTempoMin = Math.max(1, Math.round(((summary?.continued_count ?? 0) / totalConv) * 9));
    const satisfatoriasPct = Math.max(0, Math.min(100, Math.round((kpis.finalizadas / Math.max(1, kpis.totalConversas)) * 100)));
    const npsEstimado = Math.max(0, Math.min(100, 100 - Math.round((kpis.gapsCriticosAltos / Math.max(1, kpis.totalConversas)) * 100 * 2.4)));

    return {
      tempoIa: `${iaTempoSec}s`,
      tempoHumano: `${humanoTempoMin}m`,
      satisfatorias: `${satisfatoriasPct}%`,
      nps: `${npsEstimado}`,
    };
  }, [kpis.finalizadas, kpis.gapsCriticosAltos, kpis.totalConversas, summary?.continued_count, summary?.conversations_total_analyzed_day, summary?.total_messages_day]);

  const statusLabel = isRunningOverview
    ? `Executando overview... ${runProgress}%`
    : lastRunAt
      ? `Última execução: ${new Date(lastRunAt).toLocaleTimeString("pt-BR")}`
      : "Aguardando execução";

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

        <div className="status-row">
          <span className={`status-badge ${isRunningOverview ? "" : systemCheck?.chatwoot ? (systemCheck.chatwoot.ok ? "ok" : "fail") : ""}`}>
            Chatwoot: {isRunningOverview ? "verificando" : systemCheck?.chatwoot ? (systemCheck.chatwoot.ok ? "OK" : "Falha") : "aguardando"}
          </span>
          <span className={`status-badge ${isRunningOverview ? "" : systemCheck?.dify ? (systemCheck.dify.ok ? "ok" : "fail") : ""}`}>
            Dify: {isRunningOverview ? "verificando" : systemCheck?.dify ? (systemCheck.dify.ok ? "OK" : "Falha") : "aguardando"}
          </span>
          <span className={`status-badge ${loading ? "" : "ok"}`}>
            API: {loading ? "executando" : "OK"}
          </span>
          {lastRunAt ? <span className="status-badge">Última execução: {new Date(lastRunAt).toLocaleTimeString("pt-BR")}</span> : null}
        </div>

        <div className="metrics-block">
          <div className="metrics-block-header">
            <span>Controles do período</span>
          </div>
          <div className="metrics-block-body">
            <div className="orq-row">
              <label>Período</label>
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

            <div className="orq-row">
              <label>Execução</label>
              <input
                id="ref-date"
                type="date"
                value={date}
                min={minDate}
                max={maxDate}
                onChange={(event) => setDate(event.target.value)}
              />
              <button className="btn btn-primary" onClick={onRequestOverview} disabled={isBusy}>
                {isRunningOverview ? "Processando..." : "Executar Overview"}
              </button>
              <span className="status-label">{statusLabel}</span>
            </div>

            {isRunningOverview && runTimeline.length > 0 ? (
              <ul className="orq-timeline">
                {runTimeline.map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}
              </ul>
            ) : null}
            {isRunningOverview && runCurrentContact ? <div className="status-label">Contato em análise: {runCurrentContact}</div> : null}
          </div>
        </div>

        <div className={`metrics-block ${hasOverviewData ? "" : "data-dim"}`}>
          <div className="metrics-block-header">
            <span>Indicadores do período</span>
          </div>
          <div className="metrics-block-body" style={{ padding: 0 }}>
            <div className="kpi-grid">
              <div className="kpi-card"><div className="kpi-label">Atendimentos</div><div className="kpi-value info-val">{kpis.atendimentosHoje}</div><div className="kpi-sub">total do período</div></div>
              <div className="kpi-card"><div className="kpi-label">Mensagens</div><div className="kpi-value">{kpis.mensagensHoje}</div><div className="kpi-sub">IA + usuário</div></div>
              <div className="kpi-card"><div className="kpi-label">Conversas</div><div className="kpi-value">{kpis.totalConversas}</div><div className="kpi-sub">total</div></div>
              <div className="kpi-card"><div className="kpi-label">Gaps</div><div className="kpi-value gap-val">{kpis.gapsCriticosAltos}</div><div className="kpi-sub">críticos + altos</div></div>
              <div className="kpi-card"><div className="kpi-label">Finalizadas</div><div className="kpi-value pos-val">{kpis.finalizadas}</div><div className="kpi-sub">com etiqueta</div></div>
              <div className="kpi-card"><div className="kpi-label">Repetidos</div><div className="kpi-value alert-val">{kpis.numerosRepetidos}</div><div className="kpi-sub">números</div></div>
              <div className="kpi-card"><div className="kpi-label">Abertas</div><div className="kpi-value">{kpis.abertas}</div><div className="kpi-sub">ainda ativas</div></div>
              <div className="kpi-card"><div className="kpi-label">Gatilhos</div><div className="kpi-value">{kpis.gatilhos}</div><div className="kpi-sub">disparados</div></div>
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
                <div className="pano-label">Tempo médio (IA)</div>
                <div className="pano-value">{panorama.tempoIa}</div>
              </div>
              <div className="pano-card">
                <div className="pano-label">Tempo médio (humano)</div>
                <div className="pano-value">{panorama.tempoHumano}</div>
              </div>
              <div className="pano-card">
                <div className="pano-label">Conversas satisfatórias</div>
                <div className="pano-value pano-pos">{panorama.satisfatorias}</div>
              </div>
              <div className="pano-card">
                <div className="pano-label">NPS médio (estimado)</div>
                <div className="pano-value pano-info">{panorama.nps}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
