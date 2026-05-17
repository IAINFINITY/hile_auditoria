import { useMemo, useState } from "react";
import type { InsightItem, Severity } from "../../../types";
import type { ProductDemandItem } from "../shared/types";
import { toTitleCaseName } from "../hooks/controller/common";

interface ProductsViewProps {
  items: ProductDemandItem[];
  selectedDate: string;
  informationalInsights: InsightItem[];
  contextInsights?: InsightItem[];
  showHeader?: boolean;
}

type ContextSeverityFilter = "all" | Severity;

const CONTEXT_PAGE_SIZE = 5;

function severityLabel(value: Severity): string {
  if (value === "critical") return "Crítico";
  if (value === "high") return "Alto";
  if (value === "medium") return "Médio";
  if (value === "low") return "Baixo";
  return "Informativo";
}

function severityMarkerColor(value: Severity): string {
  if (value === "critical") return "var(--critical)";
  if (value === "high") return "var(--high)";
  if (value === "medium") return "var(--medium)";
  if (value === "low") return "var(--low)";
  return "var(--info)";
}

export function ProductsView({
  items,
  selectedDate,
  informationalInsights,
  contextInsights,
  showHeader = true,
}: ProductsViewProps) {
  const [contextFilter, setContextFilter] = useState<ContextSeverityFilter>("all");
  const [contextPage, setContextPage] = useState<number>(1);

  const hasProducts = items.length > 0;
  const baseContextInsights = useMemo(() => {
    if ((contextInsights || []).length > 0) return contextInsights || [];
    return informationalInsights;
  }, [contextInsights, informationalInsights]);

  const filteredContextInsights = useMemo(() => {
    if (contextFilter === "all") return baseContextInsights;
    return baseContextInsights.filter((item) => item.severity === contextFilter);
  }, [baseContextInsights, contextFilter]);

  const totalContextPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredContextInsights.length / CONTEXT_PAGE_SIZE));
  }, [filteredContextInsights.length]);

  const visibleContextInsights = useMemo(() => {
    const currentPage = Math.min(contextPage, totalContextPages);
    const start = (currentPage - 1) * CONTEXT_PAGE_SIZE;
    return filteredContextInsights.slice(start, start + CONTEXT_PAGE_SIZE);
  }, [contextPage, filteredContextInsights, totalContextPages]);

  const hasInformational = filteredContextInsights.length > 0;
  const displayContextPage = Math.min(contextPage, totalContextPages);
  const rootClass = showHeader ? "settings-shell reveal" : "analysis-content-shell reveal";

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

  function applyContextFilter(next: ContextSeverityFilter) {
    keepScroll(() => {
      setContextFilter(next);
      setContextPage(1);
    });
  }

  return (
    <section className={rootClass}>
      {showHeader ? (
        <header className="settings-header" id="analysis-overview">
          <h2>Análise Geral do Dia</h2>
          <p>Esta análise geral reflete exatamente os dados do dia selecionado: {selectedDate}.</p>
        </header>
      ) : null}

      <div className={`metrics-block ${hasProducts ? "" : "data-dim"}`} id="analysis-produtos">
        <div className="metrics-block-header">
          <span>Produtos Procurados</span>
        </div>
        <div className="metrics-block-body">
          {!hasProducts ? (
            <p className="empty-state">Ainda não há produtos mapeados para este período.</p>
          ) : (
            <div className="report-list-animated">
              {items.map((item) => (
                <article className="report-card" key={item.name}>
                  <span className="report-card-dot" style={{ background: "var(--azul)" }} />
                  <div className="report-card-content">
                    <h4>{item.name}</h4>
                    <p>
                      <strong>Ocorrências:</strong> {item.count}
                    </p>
                    <p>
                      <strong>Clientes únicos:</strong> {item.contacts}
                    </p>
                    <p>
                      <strong>Usuários:</strong>{" "}
                      {item.contactNames.length > 4
                        ? `${item.contactNames
                            .slice(0, 4)
                            .map((name) => toTitleCaseName(name))
                            .join(" • ")} +${item.contactNames.length - 4}`
                        : item.contactNames.map((name) => toTitleCaseName(name)).join(" • ")}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`metrics-block ${hasInformational ? "" : "data-dim"}`} id="analysis-informativo">
        <div className="metrics-block-header">
          <span>Contexto Informativo</span>
          <span>{filteredContextInsights.length} registro(s)</span>
        </div>
        <div className="metrics-block-body">
          <div className="btn-group" style={{ marginBottom: "12px" }}>
            <button type="button" className={`gap-chip ${contextFilter === "all" ? "active" : ""}`} onClick={() => applyContextFilter("all")}>
              Todos
            </button>
            <button type="button" className={`gap-chip ${contextFilter === "critical" ? "active" : ""}`} onClick={() => applyContextFilter("critical")}>
              Crítico
            </button>
            <button type="button" className={`gap-chip ${contextFilter === "high" ? "active" : ""}`} onClick={() => applyContextFilter("high")}>
              Alto
            </button>
            <button type="button" className={`gap-chip ${contextFilter === "medium" ? "active" : ""}`} onClick={() => applyContextFilter("medium")}>
              Médio
            </button>
            <button type="button" className={`gap-chip ${contextFilter === "low" ? "active" : ""}`} onClick={() => applyContextFilter("low")}>
              Baixo
            </button>
            <button type="button" className={`gap-chip ${contextFilter === "info" ? "active" : ""}`} onClick={() => applyContextFilter("info")}>
              Informativo
            </button>
          </div>

          {!hasInformational ? (
            <p className="empty-state">Nenhum registro disponível para o filtro selecionado.</p>
          ) : (
            <div className="report-list-animated">
              {visibleContextInsights.map((item) => (
                <article className="report-card" key={item.id}>
                  <span className="report-card-dot" style={{ background: severityMarkerColor(item.severity) }} />
                  <div className="report-card-content">
                    <h4>{toTitleCaseName(item.contact_name)}</h4>
                    <p>{item.summary}</p>
                    <p>
                      <strong>Severidade:</strong> {severityLabel(item.severity)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}

          {filteredContextInsights.length > CONTEXT_PAGE_SIZE ? (
            <div className="pagination-row">
              <span>
                {filteredContextInsights.length} registros • Página {displayContextPage} de {totalContextPages}
              </span>
              <button
                type="button"
                onClick={() => keepScroll(() => setContextPage(Math.max(1, displayContextPage - 1)))}
                disabled={displayContextPage <= 1}
              >
                {"<"}
              </button>
              <button
                type="button"
                onClick={() => keepScroll(() => setContextPage(Math.min(totalContextPages, displayContextPage + 1)))}
                disabled={displayContextPage >= totalContextPages}
              >
                {">"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
