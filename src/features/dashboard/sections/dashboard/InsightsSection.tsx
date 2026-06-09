import { useMemo, useState } from "react";
import type { InsightItem } from "../../../../types";
import { Gauge } from "../../charts/Gauge";
import { useEnterViewport } from "../../hooks/useEnterViewport";
import type { InsightFilter, RiskRow } from "../../shared/types";
import { toTitleCaseName } from "../../hooks/controller/common";
import { severityColors } from "../../shared/constants";
import { HileEmptyPanel, HileSectionShell, HileSurfaceCard } from "../../shared/ui/HilePrimitives";

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

function labelClass(tag: string): string {
  const value = String(tag || "").toLowerCase();
  if (value.includes("lead_agendado")) return "tag tag-ok";
  if (value.includes("pausar_ia")) return "tag tag-pause";
  if (value.includes("quente")) return "tag tag-warm";
  return "tag";
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
  const [animationSeed, setAnimationSeed] = useState(0);
  const { rootRef: riskTableRef, hasEntered: riskTableEntered } = useEnterViewport<HTMLDivElement>();
  const hasInsightsData = insightsReady && riskRows.total > 0;
  const improvements = useMemo(() => visibleInsights, [visibleInsights]);

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
    ];
  }, [improvements]);

  const displayPage = Math.min(insightsPage, totalInsightPages);

  function keepScroll(update: () => void) {
    const y = typeof window !== "undefined" ? window.scrollY : 0;
    update();
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: "auto" });
        requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "auto" }));
      });
    }
  }

  function handleFilterChange(next: InsightFilter) {
    keepScroll(() => setInsightFilter(next));
    setAnimationSeed((value) => value + 1);
  }

  function handlePageChange(next: number) {
    keepScroll(() => setInsightsPage(next));
    setAnimationSeed((value) => value + 1);
  }

  return (
    <div className="section reveal" id="insights">
      <div className="section-inner">
        <HileSectionShell
          eyebrow="03"
          title="Insights de Melhoria"
          description="Insights médios e baixos organizados por prioridade para orientar os próximos ajustes."
        >
          <div className="insights-dashboard">
            <div className="insights-top">
              <HileSurfaceCard
                title="Saúde do dia"
                description="Meta: zero casos críticos e leitura rápida do nível geral de estabilidade."
                tone="accent"
                className={hasInsightsData ? "" : "data-dim"}
              >
                <Gauge key={`gauge-${overviewRunCount}`} current={gaugeData.current} total={gaugeData.total} hasData={hasInsightsData} />
              </HileSurfaceCard>

              <HileSurfaceCard
                title="Distribuição de risco"
                description="Quebra percentual das severidades detectadas no período."
                className={hasInsightsData ? "" : "data-dim"}
              >
                <div ref={riskTableRef} className={`viewport-table ${riskTableEntered ? "is-entered" : ""}`}>
                  <table className="risk-table">
                    <thead>
                      <tr>
                        <th>Severidade</th>
                        <th>Qtd</th>
                        <th>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {riskRows.total === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ textAlign: "center", padding: "1rem" }}>
                            Sem dados para o período.
                          </td>
                        </tr>
                      ) : (
                        riskRows.rows.map((row) => (
                          <tr key={row.key}>
                            <td>
                              <span
                                className="sev-dot"
                                style={{
                                  background:
                                    severityColors[row.key],
                                }}
                              />
                              {row.label}
                            </td>
                            <td>{row.count}</td>
                            <td>{row.pct}%</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </HileSurfaceCard>
            </div>

            <HileSurfaceCard
              title="Filtros de insights"
              description={`${filteredInsights.length} registro(s) no recorte atual.`}
              className={insightsReady ? "" : "data-dim"}
            >
              <div className="btn-group">
                <button type="button" className={`gap-chip ${insightFilter === "all" ? "active" : ""}`} onClick={() => handleFilterChange("all")}>
                  Todos
                </button>
                <button
                  type="button"
                  className={`gap-chip ${insightFilter === "medium" ? "active" : ""}`}
                  onClick={() => handleFilterChange("medium")}
                >
                  Médio
                </button>
                <button type="button" className={`gap-chip ${insightFilter === "low" ? "active" : ""}`} onClick={() => handleFilterChange("low")}>
                  Baixo
                </button>
              </div>
            </HileSurfaceCard>

            <div id="insightGroups">
              {improvements.length === 0 ? (
                <HileEmptyPanel
                  title="Sem insights de melhoria no filtro atual."
                  description="Quando surgirem oportunidades médias ou baixas, elas aparecerão organizadas aqui."
                />
              ) : (
                groups.map((group) => {
                  if (!group.items.length) return null;
                  return (
                    <HileSurfaceCard key={group.key} title={group.title} description={group.desc} className={insightsReady ? "" : "data-dim"}>
                      <div className="insights-grid insights-grid-animated" key={`${group.key}-${insightFilter}-${displayPage}-${animationSeed}`}>
                        {group.items.map((item) => (
                          <div className="insight-item" key={item.id}>
                            <div className="insight-bar" style={{ background: group.color }} />
                            <div className="insight-body">
                              <h3 className="insight-item-title">{item.title}</h3>
                              <p className="insight-item-desc">{item.summary}</p>
                              <div className="insight-item-meta">
                                {toTitleCaseName(item.contact_name || "")} • conversa #{item.conversation_id}
                              </div>
                              <div className="gap-label-row">
                                {(item.labels || []).length > 0 ? (
                                  (item.labels || []).map((tag) => (
                                    <span className={labelClass(tag)} key={`${item.id}-${tag}`}>
                                      {tag}
                                    </span>
                                  ))
                                ) : (
                                  <span className="tag">sem etiqueta</span>
                                )}
                              </div>
                              <button
                                type="button"
                                className="link-btn link-btn-spaced"
                                onClick={() => onOpenReportByContact(toTitleCaseName(item.contact_name || ""))}
                              >
                                Ver relatório desta pessoa
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </HileSurfaceCard>
                  );
                })
              )}
            </div>

            {filteredInsights.length > visibleInsights.length ? (
              <div className="pagination-row">
                <span>
                  {filteredInsights.length} registros • Página {displayPage} de {totalInsightPages}
                </span>
                <button type="button" onClick={() => handlePageChange(Math.max(1, displayPage - 1))} disabled={displayPage <= 1}>
                  {"<"}
                </button>
                <button
                  type="button"
                  onClick={() => handlePageChange(Math.min(totalInsightPages, displayPage + 1))}
                  disabled={displayPage >= totalInsightPages}
                >
                  {">"}
                </button>
              </div>
            ) : null}
          </div>
        </HileSectionShell>
      </div>
    </div>
  );
}
