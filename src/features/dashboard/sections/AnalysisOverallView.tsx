import { useEffect, useMemo, useState } from "react";
import type { AnalysisOverallResponse, Severity } from "../../../types";
import { apiGet } from "@/lib/api";
import { DonutChart } from "../charts/DonutChart";
import { toTitleCaseName } from "../hooks/controller/common";

interface AnalysisOverallViewProps {
  refreshHint?: string | null;
}

function severityLabel(value: Severity): string {
  if (value === "critical") return "Crítico";
  if (value === "high") return "Alto";
  if (value === "medium") return "Médio";
  if (value === "low") return "Baixo";
  return "Informativo";
}

export function AnalysisOverallView({ refreshHint }: AnalysisOverallViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<AnalysisOverallResponse | null>(null);
  const [contextPage, setContextPage] = useState(1);
  const contextPageSize = 8;

  useEffect(() => {
    let cancelled = false;

    apiGet<AnalysisOverallResponse>("/api/analysis/overall?limit=500")
      .then((data) => {
        if (cancelled) return;
        setError("");
        setPayload(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar análise total.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshHint]);

  const contextItems = useMemo(() => payload?.context_items || [], [payload?.context_items]);
  const totalContextPages = Math.max(1, Math.ceil(contextItems.length / contextPageSize));
  const safeContextPage = Math.min(contextPage, totalContextPages);
  const visibleContext = useMemo(() => {
    const start = (safeContextPage - 1) * contextPageSize;
    return contextItems.slice(start, start + contextPageSize);
  }, [contextItems, safeContextPage]);

  const hasData = Boolean(payload && payload.total_runs > 0);
  const severitySnapshot = payload?.severity_snapshot || {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  return (
    <div className="settings-animated analysis-animated">
      <div className="section reveal" id="analysis-overview">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-num">01</span>
            <div className="section-title">
              <h2>Análise Geral Total</h2>
              <p>
                Consolidado de todas as execuções salvas
                {payload?.date_range?.from && payload?.date_range?.to
                  ? ` (${payload.date_range.from} até ${payload.date_range.to})`
                  : "."}
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className={`analysis-content-shell reveal ${hasData ? "" : "data-dim"}`}>
        <article className="settings-card">
          <div className="settings-card-head">Resumo total</div>
          <div className="settings-card-body dissatisfaction-kpis">
            <p><strong>Execuções:</strong> {payload?.total_runs || 0}</p>
            <p><strong>Conversas varridas:</strong> {payload?.overview.conversations_scanned || 0}</p>
            <p><strong>Conversas analisadas:</strong> {payload?.overview.conversations_total_analyzed || 0}</p>
            <p><strong>Contatos únicos:</strong> {payload?.overview.unique_contacts || 0}</p>
            <p><strong>Mensagens:</strong> {payload?.overview.total_messages || 0}</p>
            <p><strong>Críticos:</strong> {payload?.overview.critical_insights_count || 0}</p>
          </div>
        </article>
      </section>

      <div className="section reveal" id="analysis-movimentacao">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-num">02</span>
            <div className="section-title">
              <h2>Distribuição de Severidade</h2>
              <p>Consolidado por nível em todas as execuções salvas</p>
            </div>
          </div>
        </div>
      </div>

      <section className={`analysis-content-shell reveal ${hasData ? "" : "data-dim"}`}>
        <article className="settings-card">
          <div className="settings-card-head">Severidade agregada</div>
          <div className="settings-card-body movement-pie-wrap">
            <div style={{ display: "grid", placeItems: "center" }}>
              <DonutChart snapshot={severitySnapshot} size={260} centerLabel="insights" />
            </div>
            <div className="severity-legend">
              {(Object.keys(severitySnapshot) as Severity[]).map((severity) => (
                <div className="severity-legend-item" key={severity}>
                  <span className="severity-legend-dot" />
                  {severityLabel(severity)}
                  <span className="severity-legend-count">{severitySnapshot[severity] || 0}</span>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>

      <div className="section reveal" id="analysis-conteudo">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-num">03</span>
            <div className="section-title">
              <h2>Contexto Total</h2>
              <p>Resumo dos contatos mais recentes no consolidado geral</p>
            </div>
          </div>
        </div>
      </div>

      <section className={`analysis-content-shell reveal ${visibleContext.length > 0 ? "" : "data-dim"}`}>
        <article className="settings-card">
          <div className="settings-card-head">Registros contextuais</div>
          <div className="settings-card-body">
            {loading ? <p className="empty-state">Carregando análise total...</p> : null}
            {!loading && error ? <p className="empty-state">{error}</p> : null}
            {!loading && !error && visibleContext.length === 0 ? (
              <p className="empty-state">Sem contexto informativo consolidado.</p>
            ) : null}

            {!loading && !error && visibleContext.length > 0 ? (
              <div className="report-list-animated">
                {visibleContext.map((item) => (
                  <article className="report-card" key={item.id}>
                    <span className="report-card-dot" />
                    <div className="report-card-content">
                      <h4>{toTitleCaseName(item.contact_name)}</h4>
                      <p>{item.summary}</p>
                      <p>
                        <strong>Data:</strong> {item.date} • <strong>Severidade:</strong> {severityLabel(item.severity)}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            {contextItems.length > contextPageSize ? (
              <div className="pagination-row">
                <span>
                  {contextItems.length} registros • Página {safeContextPage} de {totalContextPages}
                </span>
                <button type="button" onClick={() => setContextPage(Math.max(1, safeContextPage - 1))} disabled={safeContextPage <= 1}>
                  {"<"}
                </button>
                <button type="button" onClick={() => setContextPage(Math.min(totalContextPages, safeContextPage + 1))} disabled={safeContextPage >= totalContextPages}>
                  {">"}
                </button>
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}
