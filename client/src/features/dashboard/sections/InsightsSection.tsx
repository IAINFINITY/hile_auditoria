import { useMemo } from "react";
import type { InsightItem } from "../../../types";
import { Gauge } from "../charts/Gauge";
import type { InsightFilter, RiskRow } from "../shared/types";

interface InsightsSectionProps {
  insightsReady: boolean;
  gaugeData: { current: number; total: number };
  overviewRunCount: number;
  riskRows: { rows: RiskRow[]; total: number };
  insightFilter: InsightFilter;
  setInsightFilter: (value: InsightFilter) => void;
  visibleInsights: InsightItem[];
  filteredInsights: InsightItem[];
  insightsPage: number;
  totalInsightPages: number;
  setInsightsPage: (value: number) => void;
  onOpenReportByContact: (contactName: string) => void;
}

export function InsightsSection({
  insightsReady,
  gaugeData,
  overviewRunCount,
  riskRows,
  insightFilter,
  setInsightFilter,
  visibleInsights,
  filteredInsights,
  insightsPage,
  totalInsightPages,
  setInsightsPage,
  onOpenReportByContact,
}: InsightsSectionProps) {
  const hasInsightsData = insightsReady && riskRows.total > 0;
  const improvements = useMemo(
    () => visibleInsights.filter((item) => item.severity === "medium" || item.severity === "low" || item.severity === "info"),
    [visibleInsights],
  );

  const groups = useMemo(() => {
    return [
      {
        key: "medium",
        title: "Médio",
        desc: "Requer atenção",
        color: "var(--medium)",
        items: improvements.filter((item) => item.severity === "medium"),
      },
      {
        key: "low",
        title: "Baixo",
        desc: "Oportunidade de melhoria",
        color: "var(--low)",
        items: improvements.filter((item) => item.severity === "low"),
      },
      {
        key: "info",
        title: "Informativo",
        desc: "Dados relevantes",
        color: "var(--info)",
        items: improvements.filter((item) => item.severity === "info"),
      },
    ];
  }, [improvements]);

  return (
    <div className="section reveal" id="insights">
      <div className="section-inner">
        <div className="section-header">
          <span className="section-num">03</span>
          <div className="section-title">
            <h2>Insights de Melhoria</h2>
            <p>Médio, baixo e informativo organizados por prioridade</p>
          </div>
        </div>

        <div className="insights-dashboard">
          <div className="insights-top">
            <div className={`metrics-block ${hasInsightsData ? "" : "data-dim"}`}>
              <div className="metrics-block-header">
                <span>Saúde do dia</span>
                <span>Meta: zero casos críticos</span>
              </div>
              <div className="metrics-block-body">
                <Gauge
                  key={`gauge-${overviewRunCount}`}
                  current={gaugeData.current}
                  total={gaugeData.total}
                  hasData={hasInsightsData}
                />
              </div>
            </div>

            <div className={`metrics-block ${hasInsightsData ? "" : "data-dim"}`}>
              <div className="metrics-block-header">
                <span>Distribuição de risco</span>
              </div>
              <div className="metrics-block-body">
                <table className="risk-table">
                  <thead>
                    <tr><th>Severidade</th><th>Qtd</th><th>%</th></tr>
                  </thead>
                  <tbody>
                    {riskRows.total === 0 ? (
                      <tr><td colSpan={3} style={{ textAlign: "center", padding: "1rem" }}>Sem dados para o período.</td></tr>
                    ) : (
                      riskRows.rows.map((row) => (
                        <tr key={row.key}>
                          <td><span className="sev-dot" style={{ background: row.key === "critical" ? "var(--critical)" : row.key === "high" ? "var(--high)" : row.key === "medium" ? "var(--medium)" : row.key === "low" ? "var(--low)" : "var(--info)" }} />{row.label}</td>
                          <td>{row.count}</td>
                          <td>{row.pct}%</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className={`metrics-block ${insightsReady ? "" : "data-dim"}`}>
            <div className="metrics-block-header">
              <span>Filtros de insights</span>
            </div>
            <div className="metrics-block-body">
              <div className="btn-group">
                <button className={`gap-chip ${insightFilter === "all" ? "active" : ""}`} onClick={() => setInsightFilter("all")}>Todos</button>
                <button className={`gap-chip ${insightFilter === "medium" ? "active" : ""}`} onClick={() => setInsightFilter("medium")}>Médio</button>
                <button className={`gap-chip ${insightFilter === "low" ? "active" : ""}`} onClick={() => setInsightFilter("low")}>Baixo</button>
                <button className={`gap-chip ${insightFilter === "info" ? "active" : ""}`} onClick={() => setInsightFilter("info")}>Informativo</button>
              </div>
            </div>
          </div>

          <div id="insightGroups">
            {improvements.length === 0 ? (
              <p className="empty-state">Sem insights de melhoria no filtro atual.</p>
            ) : (
              groups.map((group) => {
                if (!group.items.length) return null;
                return (
                  <div className={`metrics-block insight-group ${insightsReady ? "" : "data-dim"}`} key={group.key}>
                    <div className="metrics-block-header" style={{ background: group.color, color: "#fff" }}>
                      <span>{group.title}</span>
                      <span style={{ fontSize: "var(--fs-tiny)", opacity: 0.85 }}>{group.desc}</span>
                    </div>
                    <div className="metrics-block-body">
                      <div className="insights-grid">
                        {group.items.map((item) => (
                          <div className="insight-item" key={item.id}>
                            <div className="insight-bar" style={{ background: group.color }} />
                            <div className="insight-body">
                              <h3 className="insight-item-title">{item.title}</h3>
                              <p className="insight-item-desc">{item.summary}</p>
                              <div className="insight-item-meta">{item.contact_name} • conversa #{item.conversation_id}</div>
                              <button
                                type="button"
                                className="link-btn"
                                onClick={() => onOpenReportByContact(item.contact_name)}
                              >
                                Ver relatório desta pessoa
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {filteredInsights.length > visibleInsights.length ? (
            <div className="pagination-row">
              <span>Pág. {insightsPage} de {totalInsightPages}</span>
              <button onClick={() => setInsightsPage(Math.max(1, insightsPage - 1))} disabled={insightsPage <= 1}>‹</button>
              <button onClick={() => setInsightsPage(Math.min(totalInsightPages, insightsPage + 1))} disabled={insightsPage >= totalInsightPages}>›</button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
