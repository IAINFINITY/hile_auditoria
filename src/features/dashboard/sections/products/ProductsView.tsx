import { useMemo, useState } from "react";
import type { InsightItem, Severity } from "../../../../types";
import type { ProductDemandItem } from "../../shared/types";
import { toTitleCaseName } from "../../hooks/controller/common";
import { canonicalizeProductLabel, normalizeProductForMatch } from "@/lib/products/canonical";

interface ProductsViewProps {
  items: ProductDemandItem[];
  selectedDate: string;
  informationalInsights: InsightItem[];
  contextInsights?: InsightItem[];
  showHeader?: boolean;
}

type ContextSeverityFilter = "all" | Severity;
type ProductsSortMode = "count" | "name";
type ProductTone = "tone-1" | "tone-2" | "tone-3" | "tone-default";

const CONTEXT_PAGE_SIZE = 5;
const PRODUCTS_PAGE_SIZE = 6;

function severityLabel(value: Severity): string {
  if (value === "critical") return "Critico";
  if (value === "high") return "Alto";
  if (value === "medium") return "Medio";
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

function toneByIndex(index: number): ProductTone {
  if (index === 0) return "tone-1";
  if (index === 1) return "tone-2";
  if (index === 2) return "tone-3";
  return "tone-default";
}

function aggregateDayProducts(items: ProductDemandItem[]): ProductDemandItem[] {
  const map = new Map<string, { name: string; count: number; contactNames: Set<string> }>();

  for (const item of items || []) {
    const label = canonicalizeProductLabel(item.name);
    const key = normalizeProductForMatch(label);
    if (!key) continue;

    const current = map.get(key) || {
      name: label,
      count: 0,
      contactNames: new Set<string>(),
    };

    current.count += Number(item.count || 0);
    for (const contactName of item.contactNames || []) {
      const normalized = toTitleCaseName(contactName);
      if (!normalized) continue;
      current.contactNames.add(normalized);
    }
    map.set(key, current);
  }

  return Array.from(map.values())
    .map((entry) => ({
      name: entry.name,
      count: entry.count,
      contacts: entry.contactNames.size,
      contactNames: Array.from(entry.contactNames).sort((a, b) => a.localeCompare(b, "pt-BR")),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
}

export function ProductsView({
  items,
  selectedDate,
  informationalInsights,
  contextInsights,
  showHeader = true,
}: ProductsViewProps) {
  const [contextFilter, setContextFilter] = useState<ContextSeverityFilter>("all");
  const [contextContactFilter, setContextContactFilter] = useState<string>("all");
  const [contextQuery, setContextQuery] = useState<string>("");
  const [contextPage, setContextPage] = useState<number>(1);

  const [productsSortMode, setProductsSortMode] = useState<ProductsSortMode>("count");
  const [productsQuery, setProductsQuery] = useState<string>("");
  const [productsPage, setProductsPage] = useState<number>(1);

  const productItems = useMemo(() => aggregateDayProducts(items), [items]);
  const hasProducts = productItems.length > 0;

  const filteredProducts = useMemo(() => {
    const query = normalizeProductForMatch(productsQuery);
    const list = productItems.filter((item) => {
      if (!query) return true;
      return normalizeProductForMatch(item.name).includes(query);
    });

    return [...list].sort((a, b) => {
      if (productsSortMode === "name") return a.name.localeCompare(b.name, "pt-BR");
      return b.count - a.count || a.name.localeCompare(b.name, "pt-BR");
    });
  }, [productItems, productsQuery, productsSortMode]);

  const totalProductsPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredProducts.length / PRODUCTS_PAGE_SIZE));
  }, [filteredProducts.length]);

  const safeProductsPage = Math.min(productsPage, totalProductsPages);
  const visibleProducts = useMemo(() => {
    const start = (safeProductsPage - 1) * PRODUCTS_PAGE_SIZE;
    return filteredProducts.slice(start, start + PRODUCTS_PAGE_SIZE);
  }, [filteredProducts, safeProductsPage]);

  const topProducts = useMemo(() => filteredProducts.slice(0, 5), [filteredProducts]);
  const topProductsMax = useMemo(() => Math.max(1, ...topProducts.map((item) => Number(item.count || 0))), [topProducts]);

  const baseContextInsights = useMemo(() => {
    if ((contextInsights || []).length > 0) return contextInsights || [];
    return informationalInsights;
  }, [contextInsights, informationalInsights]);

  const contextContactOptions = useMemo(() => {
    return Array.from(
      new Set(baseContextInsights.map((item) => toTitleCaseName(item.contact_name)).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [baseContextInsights]);

  const filteredContextInsights = useMemo(() => {
    const query = contextQuery.trim().toLowerCase();
    return baseContextInsights.filter((item) => {
      if (contextFilter !== "all" && item.severity !== contextFilter) return false;
      if (contextContactFilter !== "all" && toTitleCaseName(item.contact_name) !== contextContactFilter) return false;
      if (!query) return true;
      const contact = String(item.contact_name || "").toLowerCase();
      const summary = String(item.summary || "").toLowerCase();
      return contact.includes(query) || summary.includes(query);
    });
  }, [baseContextInsights, contextContactFilter, contextFilter, contextQuery]);

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
          <h2>Analise Geral do Dia</h2>
          <p>Esta analise geral reflete exatamente os dados do dia selecionado: {selectedDate}.</p>
        </header>
      ) : null}

      <div className={`metrics-block ${hasProducts ? "" : "data-dim"}`} id="analysis-produtos">
        <div className="metrics-block-header">
          <span>Produtos Procurados</span>
          <span>{filteredProducts.length} produto(s)</span>
        </div>
        <div className="metrics-block-body products-context-body">
          <div className="report-filters-shell products-context-filters">
            <div className="report-filters-grid">
              <div className="report-filter-field">
                <label htmlFor="day-product-sort">Ordenar</label>
                <select
                  id="day-product-sort"
                  value={productsSortMode}
                  onChange={(event) =>
                    keepScroll(() => {
                      setProductsSortMode(event.target.value as ProductsSortMode);
                      setProductsPage(1);
                    })
                  }
                >
                  <option value="count">Quantidade</option>
                  <option value="name">Nome (A-Z)</option>
                </select>
              </div>

              <div className="report-filter-field">
                <label htmlFor="day-product-search">Pesquisar</label>
                <input
                  id="day-product-search"
                  type="text"
                  placeholder="Produto"
                  value={productsQuery}
                  onChange={(event) =>
                    keepScroll(() => {
                      setProductsQuery(event.target.value);
                      setProductsPage(1);
                    })
                  }
                />
              </div>
            </div>
          </div>

          {!hasProducts ? (
            <p className="empty-state">Ainda nao ha produtos mapeados para este periodo.</p>
          ) : (
            <>
              {topProducts.length > 0 ? (
                <div className="products-context-bars">
                  {topProducts.map((item, index) => {
                    const width = Math.round((Number(item.count || 0) / topProductsMax) * 100);
                    const tone = toneByIndex(index);
                    return (
                      <article className="products-context-bars-row" key={`bar-${item.name}`}>
                        <div className="products-context-bars-meta">
                          <strong>{item.name}</strong>
                          <span>{item.count}</span>
                        </div>
                        <div className="products-context-bars-track">
                          <span className={`products-context-bars-fill ${tone}`} style={{ width: `${Math.max(4, width)}%` }} />
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}

              {filteredProducts.length === 0 ? (
                <p className="empty-state">Nenhum produto encontrado com os filtros atuais.</p>
              ) : (
                <div className="report-list-animated products-context-list">
                  {visibleProducts.map((item, index) => {
                    const globalIndex = (safeProductsPage - 1) * PRODUCTS_PAGE_SIZE + index;
                    const tone = toneByIndex(globalIndex);
                    return (
                      <article className="report-card" key={`${item.name}-${item.count}`}>
                        <span className={`report-card-dot products-context-dot ${tone}`} />
                        <div className="report-card-content">
                          <h4>{item.name}</h4>
                          <p>
                            <strong>Quantidade:</strong> {item.count}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {filteredProducts.length > PRODUCTS_PAGE_SIZE ? (
            <div className="pagination-row">
              <span>
                {filteredProducts.length} registros • Pagina {safeProductsPage} de {totalProductsPages}
              </span>
              <button
                type="button"
                onClick={() => keepScroll(() => setProductsPage(Math.max(1, safeProductsPage - 1)))}
                disabled={safeProductsPage <= 1}
              >
                {"<"}
              </button>
              <button
                type="button"
                onClick={() => keepScroll(() => setProductsPage(Math.min(totalProductsPages, safeProductsPage + 1)))}
                disabled={safeProductsPage >= totalProductsPages}
              >
                {">"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className={`metrics-block ${hasInformational ? "" : "data-dim"}`} id="analysis-informativo">
        <div className="metrics-block-header">
          <span>Contexto Informativo</span>
          <span>{filteredContextInsights.length} registro(s)</span>
        </div>
        <div className="metrics-block-body">
          <div className="report-filters-shell" style={{ marginBottom: "12px" }}>
            <div className="report-filters-grid">
              <div className="report-filter-field">
                <label htmlFor="day-context-filter">Gaps/Severidade</label>
                <select id="day-context-filter" value={contextFilter} onChange={(event) => applyContextFilter(event.target.value as ContextSeverityFilter)}>
                  <option value="all">Todas</option>
                  <option value="critical">Critico</option>
                  <option value="high">Alto</option>
                  <option value="medium">Medio</option>
                  <option value="low">Baixo</option>
                  <option value="info">Informativo</option>
                </select>
              </div>

              <div className="report-filter-field">
                <label htmlFor="day-context-contact">Contato</label>
                <select
                  id="day-context-contact"
                  value={contextContactFilter}
                  onChange={(event) =>
                    keepScroll(() => {
                      setContextContactFilter(event.target.value);
                      setContextPage(1);
                    })
                  }
                >
                  <option value="all">Todos</option>
                  {contextContactOptions.map((contact) => (
                    <option key={contact} value={contact}>
                      {contact}
                    </option>
                  ))}
                </select>
              </div>

              <div className="report-filter-field">
                <label htmlFor="day-context-date">Data</label>
                <select id="day-context-date" value={selectedDate || "-"} disabled>
                  <option value={selectedDate || "-"}>{selectedDate || "-"}</option>
                </select>
              </div>

              <div className="report-filter-field">
                <label htmlFor="day-context-search">Pesquisar</label>
                <input
                  id="day-context-search"
                  type="text"
                  placeholder="Contato ou resumo"
                  value={contextQuery}
                  onChange={(event) =>
                    keepScroll(() => {
                      setContextQuery(event.target.value);
                      setContextPage(1);
                    })
                  }
                />
              </div>
            </div>
          </div>

          {!hasInformational ? (
            <p className="empty-state">Nenhum registro disponivel para o filtro selecionado.</p>
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
                {filteredContextInsights.length} registros • Pagina {displayContextPage} de {totalContextPages}
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
