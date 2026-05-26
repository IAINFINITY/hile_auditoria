import { useEffect, useMemo, useState } from "react";
import type { AnalysisOverallResponse, Severity } from "../../../../types";
import { apiGet } from "@/lib/api";
import { toTitleCaseName } from "../../hooks/controller/common";
import { MovementSection } from "../dashboard/MovementSection";
import { canonicalizeProductLabel, normalizeProductForMatch } from "@/lib/products/canonical";
import type { OwnerScope } from "../../shared/types";

interface AnalysisOverallViewProps {
  refreshHint?: string | null;
  sectionStart?: number;
  ownerScope: OwnerScope;
}

type ProductsOverallItem = {
  name: string;
  count: number;
  contacts: number;
  days: number;
  lastSeenDate: string | null;
};

type ProductsOverallResponse = {
  items: ProductsOverallItem[];
  totalRuns: number;
};

type ProductsSortMode = "count" | "name";
type ProductTone = "tone-1" | "tone-2" | "tone-3" | "tone-default";

const ANALYSIS_OVERALL_REVALIDATE_MS = 5 * 60 * 1000;
const ANALYSIS_OVERALL_CACHE_KEY = "hile_analysis_overall_cache_v3";
const ANALYSIS_OVERALL_META_KEY = "hile_analysis_overall_meta_v3";

const PRODUCTS_OVERALL_REVALIDATE_MS = 5 * 60 * 1000;
const PRODUCTS_OVERALL_CACHE_KEY = "hile_analysis_overall_products_cache_v2";
const PRODUCTS_OVERALL_META_KEY = "hile_analysis_overall_products_meta_v2";

function severityLabel(value: Severity): string {
  if (value === "critical") return "Crítico";
  if (value === "high") return "Alto";
  if (value === "medium") return "Médio";
  if (value === "low") return "Baixo";
  return "Informativo";
}

function dotClassForSeverity(value: Severity): string {
  if (value === "critical") return "report-card-dot-critical";
  if (value === "high") return "report-card-dot-high";
  if (value === "medium") return "report-card-dot-medium";
  if (value === "low") return "report-card-dot-low";
  return "report-card-dot-info";
}

function readCachedJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readCachedMeta(key: string): { fetchedAt: number; refreshHint: string | null } {
  if (typeof window === "undefined") return { fetchedAt: 0, refreshHint: null };
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return { fetchedAt: 0, refreshHint: null };
    const parsed = JSON.parse(raw) as { fetchedAt?: number; refreshHint?: string | null };
    return {
      fetchedAt: Number(parsed?.fetchedAt || 0),
      refreshHint: parsed?.refreshHint ? String(parsed.refreshHint) : null,
    };
  } catch {
    return { fetchedAt: 0, refreshHint: null };
  }
}

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function toneByIndex(index: number): ProductTone {
  if (index === 0) return "tone-1";
  if (index === 1) return "tone-2";
  if (index === 2) return "tone-3";
  return "tone-default";
}

function ownerScopeLabel(scope: OwnerScope): string {
  if (scope === "ia") return "IA";
  if (scope === "suellen") return "Comercial Suellen";
  if (scope === "samuel") return "Comercial Samuel";
  return "Todos";
}

export function AnalysisOverallView({ refreshHint, sectionStart = 1, ownerScope }: AnalysisOverallViewProps) {
  const analysisCacheKey = `${ANALYSIS_OVERALL_CACHE_KEY}_${ownerScope}`;
  const analysisMetaKey = `${ANALYSIS_OVERALL_META_KEY}_${ownerScope}`;
  const productsCacheKey = `${PRODUCTS_OVERALL_CACHE_KEY}_${ownerScope}`;
  const productsMetaKey = `${PRODUCTS_OVERALL_META_KEY}_${ownerScope}`;
  const cachedAnalysis = useMemo(() => readCachedJson<AnalysisOverallResponse>(analysisCacheKey), [analysisCacheKey]);
  const cachedProducts = useMemo(() => readCachedJson<ProductsOverallResponse>(productsCacheKey), [productsCacheKey]);

  const [loading, setLoading] = useState(!cachedAnalysis);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<AnalysisOverallResponse | null>(cachedAnalysis);

  const [productsLoading, setProductsLoading] = useState(!cachedProducts);
  const [productsError, setProductsError] = useState("");
  const [productsPayload, setProductsPayload] = useState<ProductsOverallResponse>(cachedProducts || { items: [], totalRuns: 0 });

  const [contextPage, setContextPage] = useState(1);
  const [contextSeverityFilter, setContextSeverityFilter] = useState<Severity | "all">("all");
  const [contextContactFilter, setContextContactFilter] = useState<string>("all");
  const [contextDateFilter, setContextDateFilter] = useState<string>("all");
  const [contextQuery, setContextQuery] = useState("");
  const [productsPage, setProductsPage] = useState(1);
  const [productsQuery, setProductsQuery] = useState("");
  const [productsSortMode, setProductsSortMode] = useState<ProductsSortMode>("count");

  const contextPageSize = 5;
  const productsPageSize = 6;

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();

    const cachedAnalysisData = readCachedJson<AnalysisOverallResponse>(analysisCacheKey);
    const cachedAnalysisMeta = readCachedMeta(analysisMetaKey);
    const isAnalysisFresh = Boolean(cachedAnalysisData) && now - cachedAnalysisMeta.fetchedAt < ANALYSIS_OVERALL_REVALIDATE_MS;

    const cachedProductsData = readCachedJson<ProductsOverallResponse>(productsCacheKey);
    const cachedProductsMeta = readCachedMeta(productsMetaKey);
    const isProductsFresh = Boolean(cachedProductsData) && now - cachedProductsMeta.fetchedAt < PRODUCTS_OVERALL_REVALIDATE_MS;

    const hasAnalysisHintUpdate =
      Boolean(refreshHint) && String(refreshHint) !== String(cachedAnalysisMeta.refreshHint || "");
    const hasProductsHintUpdate =
      Boolean(refreshHint) && String(refreshHint) !== String(cachedProductsMeta.refreshHint || "");
    const shouldFetchAnalysis = !isAnalysisFresh || hasAnalysisHintUpdate;
    const shouldFetchProducts = !isProductsFresh || hasProductsHintUpdate;

    if (shouldFetchAnalysis) {
      apiGet<AnalysisOverallResponse>(`/api/analysis/overall?limit=500&owner=${encodeURIComponent(ownerScope)}`)
        .then((data) => {
          if (cancelled) return;
          setPayload(data);
          localStorage.setItem(analysisCacheKey, JSON.stringify(data));
          sessionStorage.setItem(
            analysisMetaKey,
            JSON.stringify({ fetchedAt: Date.now(), refreshHint: refreshHint || null }),
          );
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Falha ao carregar análise total.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    if (shouldFetchProducts) {
      apiGet<ProductsOverallResponse>(`/api/products/overall?limit=300&owner=${encodeURIComponent(ownerScope)}`)
        .then((data) => {
          if (cancelled) return;
          const nextData = {
            items: Array.isArray(data?.items) ? data.items : [],
            totalRuns: Number(data?.totalRuns || 0),
          };
          setProductsPayload(nextData);
          localStorage.setItem(productsCacheKey, JSON.stringify(nextData));
          sessionStorage.setItem(
            productsMetaKey,
            JSON.stringify({ fetchedAt: Date.now(), refreshHint: refreshHint || null }),
          );
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setProductsError(err instanceof Error ? err.message : "Falha ao carregar produtos gerais.");
        })
        .finally(() => {
          if (!cancelled) setProductsLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [analysisCacheKey, analysisMetaKey, ownerScope, productsCacheKey, productsMetaKey, refreshHint]);

  const contextItems = useMemo(() => payload?.context_items || [], [payload?.context_items]);
  const contactOptions = useMemo(() => {
    return Array.from(new Set(contextItems.map((item) => toTitleCaseName(item.contact_name)).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );
  }, [contextItems]);
  const dateOptions = useMemo(() => {
    return Array.from(new Set(contextItems.map((item) => String(item.date || "")).filter(Boolean))).sort((a, b) =>
      a < b ? 1 : a > b ? -1 : 0,
    );
  }, [contextItems]);

  const filteredContextItems = useMemo(() => {
    const query = contextQuery.trim().toLowerCase();
    return contextItems.filter((item) => {
      if (contextSeverityFilter !== "all" && item.severity !== contextSeverityFilter) return false;
      if (contextContactFilter !== "all" && toTitleCaseName(item.contact_name) !== contextContactFilter) return false;
      if (contextDateFilter !== "all" && String(item.date || "") !== contextDateFilter) return false;
      if (!query) return true;
      const contact = String(item.contact_name || "").toLowerCase();
      const summary = String(item.summary || "").toLowerCase();
      const date = String(item.date || "").toLowerCase();
      return contact.includes(query) || summary.includes(query) || date.includes(query);
    });
  }, [contextItems, contextQuery, contextSeverityFilter, contextContactFilter, contextDateFilter]);

  const totalContextPages = Math.max(1, Math.ceil(filteredContextItems.length / contextPageSize));
  const safeContextPage = Math.min(contextPage, totalContextPages);
  const visibleContext = useMemo(() => {
    const start = (safeContextPage - 1) * contextPageSize;
    return filteredContextItems.slice(start, start + contextPageSize);
  }, [filteredContextItems, safeContextPage]);

  const mergedProducts = useMemo(() => {
    const map = new Map<string, ProductsOverallItem>();
    for (const item of productsPayload.items || []) {
      const label = canonicalizeProductLabel(item.name);
      const key = normalizeProductForMatch(label);
      if (!key) continue;
      const current = map.get(key);
      if (!current) {
        map.set(key, {
          name: label,
          count: Number(item.count || 0),
          contacts: Number(item.contacts || 0),
          days: Number(item.days || 0),
          lastSeenDate: item.lastSeenDate || null,
        });
        continue;
      }
      current.count += Number(item.count || 0);
      current.contacts += Number(item.contacts || 0);
      current.days += Number(item.days || 0);
      if (item.lastSeenDate && (!current.lastSeenDate || item.lastSeenDate > current.lastSeenDate)) {
        current.lastSeenDate = item.lastSeenDate;
      }
    }
    return Array.from(map.values());
  }, [productsPayload.items]);

  const filteredProducts = useMemo(() => {
    const query = normalizeProductForMatch(productsQuery);
    const filtered = mergedProducts.filter((item) => {
      if (!query) return true;
      return normalizeProductForMatch(item.name).includes(query);
    });

    return filtered.sort((a, b) => {
      if (productsSortMode === "name") return a.name.localeCompare(b.name, "pt-BR");
      return b.count - a.count || a.name.localeCompare(b.name, "pt-BR");
    });
  }, [mergedProducts, productsQuery, productsSortMode]);

  const totalProductsPages = Math.max(1, Math.ceil(filteredProducts.length / productsPageSize));
  const safeProductsPage = Math.min(productsPage, totalProductsPages);
  const visibleProducts = useMemo(() => {
    const start = (safeProductsPage - 1) * productsPageSize;
    return filteredProducts.slice(start, start + productsPageSize);
  }, [filteredProducts, safeProductsPage]);

  const topProducts = useMemo(() => filteredProducts.slice(0, 5), [filteredProducts]);
  const topProductsMax = useMemo(() => Math.max(1, ...topProducts.map((item) => Number(item.count || 0))), [topProducts]);

  const hasData = Boolean(payload && payload.total_runs > 0);
  const severitySnapshot = payload?.severity_snapshot || {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const trendSeries = payload?.trend_series || [];
  const analyzed = Number(payload?.overview.conversations_total_analyzed || 0);
  const messages = Number(payload?.overview.total_messages || 0);
  const critical = Number(payload?.overview.critical_insights_count || 0);
  const nonCritical = Number(payload?.overview.non_critical_insights_count || 0);
  const finalized = Number(payload?.overview.finalized_count || 0);
  const continued = Number(payload?.overview.continued_count || 0);
  const totalInsights = critical + nonCritical;
  const criticalRate = safeRatio(critical, totalInsights);
  const avgMessagesPerConversation = safeRatio(messages, analyzed);
  const finalizedRate = safeRatio(finalized, Math.max(1, finalized + continued));
  const hasFinalizationBase = finalized + continued > 0;

  const sectionOne = String(sectionStart).padStart(2, "0");
  const sectionTwo = String(sectionStart + 1).padStart(2, "0");
  const sectionThree = String(sectionStart + 2).padStart(2, "0");
  const sectionFour = String(sectionStart + 3).padStart(2, "0");

  return (
    <div className="settings-animated analysis-animated">
      <div className="section reveal" id="analysis-overview">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-num">{sectionOne}</span>
            <div className="section-title">
              <h2>Análise Geral Total</h2>
              <p>
                Consolidado de todas as execuções salvas
                {payload?.date_range?.from && payload?.date_range?.to
                  ? ` (${payload.date_range.from} até ${payload.date_range.to})`
                  : "."}{" "}
                • Responsável: {ownerScopeLabel(ownerScope)}.
              </p>
            </div>
          </div>
        </div>
      </div>

      <section className={`analysis-content-shell reveal ${hasData ? "" : "data-dim"}`}>
        <article className="settings-card">
          <div className="settings-card-head">Resumo total</div>
          <div className="settings-card-body analysis-overall-summary">
            <div className="analysis-overall-summary-main">
              <article className="analysis-overall-stat">
                <span className="analysis-overall-stat-label">Relatórios</span>
                <strong className="analysis-overall-stat-value">{payload?.total_runs || 0}</strong>
                <small className="analysis-overall-stat-sub">
                  {payload?.date_range?.from && payload?.date_range?.to
                    ? `${payload.date_range.from} até ${payload.date_range.to}`
                    : "Período consolidado"}
                </small>
              </article>

              <article className="analysis-overall-stat">
                <span className="analysis-overall-stat-label">Conversas</span>
                <strong className="analysis-overall-stat-value">{analyzed}</strong>
                <small className="analysis-overall-stat-sub">Total consolidado no período</small>
              </article>

              <article className="analysis-overall-stat">
                <span className="analysis-overall-stat-label">Mensagens</span>
                <strong className="analysis-overall-stat-value">{messages}</strong>
                <small className="analysis-overall-stat-sub">IA + usuário no consolidado</small>
              </article>

              <article className="analysis-overall-stat is-alert">
                <span className="analysis-overall-stat-label">Críticos</span>
                <strong className="analysis-overall-stat-value">{critical}</strong>
                <small className="analysis-overall-stat-sub">
                  {totalInsights} insights • taxa crítica {formatPercent(criticalRate)}
                </small>
              </article>
            </div>

            <div className="analysis-overall-summary-mini">
              <div className="analysis-overall-mini-item">
                <span>Média msg/conversa</span>
                <strong>{avgMessagesPerConversation.toFixed(1)}</strong>
              </div>
              <div className="analysis-overall-mini-item">
                <span>Finalizadas</span>
                <strong>{finalized}</strong>
              </div>
              <div className="analysis-overall-mini-item">
                <span>Continuadas</span>
                <strong>{continued}</strong>
              </div>
              <div className="analysis-overall-mini-item">
                <span>Taxa de finalização</span>
                <strong>{hasFinalizationBase ? formatPercent(finalizedRate) : "-"}</strong>
              </div>
            </div>
          </div>
        </article>
      </section>

      {!loading && !error ? (
        <MovementSection
          trendSeries={trendSeries}
          severitySnapshot={severitySnapshot}
          totalMessagesDay={payload?.overview.total_messages || 0}
          totalConversationsDay={payload?.overview.conversations_total_analyzed || 0}
          sectionId="analysis-movimentacao"
          sectionNumber={sectionTwo}
        />
      ) : (
        <section className="analysis-content-shell reveal" id="analysis-movimentacao">
          <article className="settings-card">
            <div className="settings-card-head">Movimentação consolidada</div>
            <div className="settings-card-body">
              {loading ? <p className="empty-state">Carregando movimentação consolidada...</p> : null}
              {!loading && error ? <p className="empty-state">{error}</p> : null}
            </div>
          </article>
        </section>
      )}

      <div className="section reveal" id="analysis-produtos-gerais">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-num">{sectionThree}</span>
            <div className="section-title">
              <h2>Produtos Gerais</h2>
              <p>Produtos consolidados de todas as execuções salvas</p>
            </div>
          </div>
        </div>
      </div>

      <section className={`analysis-content-shell reveal ${visibleProducts.length > 0 ? "" : "data-dim"}`}>
        <div className="metrics-block">
          <div className="metrics-block-header">
            <span>Produtos procurados</span>
            <span>{filteredProducts.length} produto(s)</span>
          </div>
          <div className="metrics-block-body products-context-body">
            <div className="report-filters-shell" style={{ marginBottom: "12px" }}>
              <div className="report-filters-grid">
                <div className="report-filter-field">
                  <label htmlFor="overall-products-sort">Ordenar</label>
                  <select
                    id="overall-products-sort"
                    value={productsSortMode}
                    onChange={(event) => {
                      setProductsSortMode(event.target.value as ProductsSortMode);
                      setProductsPage(1);
                    }}
                  >
                    <option value="count">Quantidade</option>
                    <option value="name">Nome (A-Z)</option>
                  </select>
                </div>

                <div className="report-filter-field">
                  <label htmlFor="overall-products-search">Pesquisar</label>
                  <input
                    id="overall-products-search"
                    type="text"
                    placeholder="Produto"
                    value={productsQuery}
                    onChange={(event) => {
                      setProductsQuery(event.target.value);
                      setProductsPage(1);
                    }}
                  />
                </div>
              </div>
            </div>

            {productsLoading ? <p className="empty-state">Carregando produtos gerais...</p> : null}
            {!productsLoading && productsError ? <p className="empty-state">{productsError}</p> : null}
            {!productsLoading && !productsError && visibleProducts.length === 0 ? (
              <p className="empty-state">Sem produtos consolidados para exibir.</p>
            ) : null}

            {!productsLoading && !productsError && topProducts.length > 0 ? (
              <div className="products-context-bars">
                {topProducts.map((item, index) => {
                  const width = Math.round((Number(item.count || 0) / topProductsMax) * 100);
                  const tone = toneByIndex(index);
                  return (
                    <article className="products-context-bars-row" key={`overall-bar-${item.name}`}>
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

            {!productsLoading && !productsError && visibleProducts.length > 0 ? (
              <div className="report-list-animated products-context-list">
                {visibleProducts.map((item, index) => {
                  const globalIndex = (safeProductsPage - 1) * productsPageSize + index;
                  const tone = toneByIndex(globalIndex);
                  return (
                  <article className="report-card" key={`${item.name}-${item.lastSeenDate || ""}`}>
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
            ) : null}

            {filteredProducts.length > productsPageSize ? (
              <div className="pagination-row">
                <span>
                  {filteredProducts.length} registros • Pagina {safeProductsPage} de {totalProductsPages}
                </span>
                <button type="button" onClick={() => setProductsPage(Math.max(1, safeProductsPage - 1))} disabled={safeProductsPage <= 1}>
                  {"<"}
                </button>
                <button type="button" onClick={() => setProductsPage(Math.min(totalProductsPages, safeProductsPage + 1))} disabled={safeProductsPage >= totalProductsPages}>
                  {">"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="section reveal" id="analysis-conteudo">
        <div className="section-inner">
          <div className="section-header">
            <span className="section-num">{sectionFour}</span>
            <div className="section-title">
              <h2>Contexto Total</h2>
              <p>Resumo dos contatos mais recentes no consolidado geral</p>
            </div>
          </div>
        </div>
      </div>

      <section className={`analysis-content-shell reveal ${visibleContext.length > 0 ? "" : "data-dim"}`}>
        <div className="metrics-block">
          <div className="metrics-block-header">
            <span>Contexto informativo</span>
            <span>{filteredContextItems.length} registro(s)</span>
          </div>
          <div className="metrics-block-body">
            <div className="report-filters-shell" style={{ marginBottom: "12px" }}>
              <div className="report-filters-grid">
                <div className="report-filter-field">
                  <label htmlFor="overall-context-filter">Gaps/Severidade</label>
                  <select
                    id="overall-context-filter"
                    value={contextSeverityFilter}
                    onChange={(event) => {
                      setContextSeverityFilter(event.target.value as Severity | "all");
                      setContextPage(1);
                    }}
                  >
                    <option value="all">Todas</option>
                    <option value="critical">{severityLabel("critical")}</option>
                    <option value="high">{severityLabel("high")}</option>
                    <option value="medium">{severityLabel("medium")}</option>
                    <option value="low">{severityLabel("low")}</option>
                    <option value="info">{severityLabel("info")}</option>
                  </select>
                </div>

                <div className="report-filter-field">
                  <label htmlFor="overall-context-contact">Contato</label>
                  <select
                    id="overall-context-contact"
                    value={contextContactFilter}
                    onChange={(event) => {
                      setContextContactFilter(event.target.value);
                      setContextPage(1);
                    }}
                  >
                    <option value="all">Todos</option>
                    {contactOptions.map((contact) => (
                      <option key={contact} value={contact}>{contact}</option>
                    ))}
                  </select>
                </div>

                <div className="report-filter-field">
                  <label htmlFor="overall-context-date">Data</label>
                  <select
                    id="overall-context-date"
                    value={contextDateFilter}
                    onChange={(event) => {
                      setContextDateFilter(event.target.value);
                      setContextPage(1);
                    }}
                  >
                    <option value="all">Todas</option>
                    {dateOptions.map((date) => (
                      <option key={date} value={date}>{date}</option>
                    ))}
                  </select>
                </div>

                <div className="report-filter-field">
                  <label htmlFor="overall-context-search">Pesquisar</label>
                  <input
                    id="overall-context-search"
                    type="text"
                    placeholder="Contato, resumo ou data"
                    value={contextQuery}
                    onChange={(event) => {
                      setContextQuery(event.target.value);
                      setContextPage(1);
                    }}
                  />
                </div>
              </div>
            </div>

            {loading ? <p className="empty-state">Carregando análise total...</p> : null}
            {!loading && error ? <p className="empty-state">{error}</p> : null}
            {!loading && !error && visibleContext.length === 0 ? (
              <p className="empty-state">Sem registros para os filtros aplicados.</p>
            ) : null}

            {!loading && !error && visibleContext.length > 0 ? (
              <div className="report-list-animated">
                {visibleContext.map((item) => (
                  <article className="report-card" key={item.id}>
                    <span className={`report-card-dot ${dotClassForSeverity(item.severity)}`} />
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

            {filteredContextItems.length > contextPageSize ? (
              <div className="pagination-row">
                <span>
                  {filteredContextItems.length} registros • Página {safeContextPage} de {totalContextPages}
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
        </div>
      </section>
    </div>
  );
}
