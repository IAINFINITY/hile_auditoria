import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { useChartEnterAnimation } from "../../charts/useChartEnterAnimation";
import type { ProductDemandItem } from "../../shared/types";

type ProductOverallItem = {
  name: string;
  count: number;
  contacts: number;
  days: number;
  lastSeenDate: string | null;
};

type ProductsOverallResponse = {
  items: ProductOverallItem[];
  totalRuns: number;
};

type ProductsOverallViewProps = {
  refreshHint?: string | null;
  showHeader?: boolean;
  scope?: "overall" | "day";
  dayItems?: ProductDemandItem[];
  selectedDate?: string;
};

type SortMode = "count" | "name";

const PRODUCTS_OVERALL_REVALIDATE_MS = 5 * 60 * 1000;
const PRODUCTS_OVERALL_CACHE_VERSION = "v2";
const PER_PAGE = 10;
const DONUT_COLORS = ["#0066cc", "#0a2b5c", "#e8a838", "#5a6f8a", "#9ea6b4", "#cd7f4b"];

function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function productCanonicalLabel(name: string): string {
  const normalized = normalizeText(name).replace(/[^a-z0-9]+/g, " ").trim();
  if (/^pre treino$/.test(normalized) || /^pretreino$/.test(normalized)) return "Pré-treino";
  if (/^pos treino$/.test(normalized) || /^post treino$/.test(normalized)) return "Pós-treino";
  if (/^whey( protein)?$/.test(normalized)) return "Whey Protein";
  if (/^creatina( monohidratada)?$/.test(normalized)) return "Creatina";
  return String(name || "").trim() || "Produto não informado";
}

function aggregateProducts(items: ProductOverallItem[]): ProductOverallItem[] {
  const map = new Map<string, ProductOverallItem>();
  for (const item of items) {
    const label = productCanonicalLabel(item.name);
    const key = normalizeText(label);
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
    current.lastSeenDate =
      !current.lastSeenDate || (item.lastSeenDate && item.lastSeenDate > current.lastSeenDate)
        ? item.lastSeenDate || current.lastSeenDate
        : current.lastSeenDate;
  }
  return Array.from(map.values());
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function readProductsOverallCache(cacheKey: string): ProductsOverallResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const cachedRaw = localStorage.getItem(cacheKey);
    if (!cachedRaw) return null;
    const cached = JSON.parse(cachedRaw) as ProductsOverallResponse;
    if (!cached || !Array.isArray(cached.items)) return null;
    return {
      items: cached.items,
      totalRuns: Number(cached.totalRuns || 0),
    };
  } catch {
    return null;
  }
}

export function ProductsOverallView({
  refreshHint = null,
  showHeader = true,
  scope = "overall",
  dayItems = [],
  selectedDate = "",
}: ProductsOverallViewProps) {
  const { rootRef: donutChartRef, progress: donutProgress } = useChartEnterAnimation<HTMLDivElement>({
    durationMs: 1250,
    delayMs: 80,
    threshold: 0.25,
  });
  const { rootRef: rankingListRef, progress: rankingListProgress } = useChartEnterAnimation<HTMLDivElement>({
    durationMs: 1150,
    threshold: 0.18,
  });

  const cacheKey = `hile_products_overall_cache_${PRODUCTS_OVERALL_CACHE_VERSION}`;
  const fetchMetaKey = `hile_products_overall_fetch_meta_${PRODUCTS_OVERALL_CACHE_VERSION}`;
  const handledRefreshHintRef = useRef<string | null>(null);
  const useApiData = scope === "overall";
  const initialCache = useApiData ? readProductsOverallCache(cacheKey) : null;
  const cachedRenderData = useApiData ? readProductsOverallCache(cacheKey) : null;
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState("");
  const [data, setData] = useState<ProductsOverallResponse>(initialCache || { items: [], totalRuns: 0 });
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("count");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!useApiData) return;
    let cancelled = false;
    const hasNewRefreshHint = Boolean(refreshHint) && refreshHint !== handledRefreshHintRef.current;
    if (hasNewRefreshHint && refreshHint) handledRefreshHintRef.current = refreshHint;

    const now = Date.now();
    const cachedRaw = localStorage.getItem(cacheKey);
    const cachedPayload = cachedRaw ? (JSON.parse(cachedRaw) as ProductsOverallResponse) : null;
    const fetchMetaRaw = sessionStorage.getItem(fetchMetaKey);
    const cachedMeta = fetchMetaRaw ? (JSON.parse(fetchMetaRaw) as { fetchedAt?: number }) : null;
    const lastFetchedAt = Number(cachedMeta?.fetchedAt || 0);
    const hasFreshCache = Boolean(cachedRaw) && now - lastFetchedAt < PRODUCTS_OVERALL_REVALIDATE_MS;

    if (hasFreshCache && !hasNewRefreshHint) {
      setLoading(false);
      setError("");
      return () => {
        cancelled = true;
      };
    }

    setLoading(!cachedRaw);
    setError("");

    apiGet<ProductsOverallResponse>("/api/products/overall?limit=300")
      .then((payload) => {
        if (cancelled) return;
        const nextData = {
          items: Array.isArray(payload?.items) ? payload.items : [],
          totalRuns: Number(payload?.totalRuns || 0),
        };
        const currentSnapshot = JSON.stringify(cachedPayload?.items || []);
        const nextSnapshot = JSON.stringify(nextData.items);
        const hasChanged =
          currentSnapshot !== nextSnapshot || Number(cachedPayload?.totalRuns || 0) !== nextData.totalRuns;
        if (hasChanged) {
          setData(nextData);
          localStorage.setItem(cacheKey, JSON.stringify(nextData));
        }
        sessionStorage.setItem(fetchMetaKey, JSON.stringify({ fetchedAt: Date.now() }));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar produtos gerais.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, fetchMetaKey, refreshHint, useApiData]);

  const scopedLoading = useApiData ? loading : false;
  const scopedError = useApiData ? error : "";

  const activeItems = useMemo<ProductOverallItem[]>(() => {
    const source = useApiData
      ? data.items.length > 0
        ? data.items
        : Array.isArray(cachedRenderData?.items)
          ? cachedRenderData.items
          : []
      : dayItems.map((item) => ({
          name: item.name,
          count: Number(item.count || 0),
          contacts: Number(item.contacts || 0),
          days: 1,
          lastSeenDate: selectedDate || null,
        }));
    return aggregateProducts(source);
  }, [cachedRenderData, data.items, dayItems, selectedDate, useApiData]);

  const summary = useMemo(() => {
    return {
      totalProducts: activeItems.length,
      totalQuantity: activeItems.reduce((acc, item) => acc + Number(item.count || 0), 0),
    };
  }, [activeItems]);

  const sortedAndFiltered = useMemo(() => {
    const q = normalizeText(query);
    const list = activeItems.filter((item) => !q || normalizeText(item.name).includes(q));
    return [...list].sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name, "pt-BR");
      return b.count - a.count || a.name.localeCompare(b.name, "pt-BR");
    });
  }, [activeItems, query, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sortedAndFiltered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * PER_PAGE;
    return sortedAndFiltered.slice(start, start + PER_PAGE);
  }, [safePage, sortedAndFiltered]);

  const maxCount = Math.max(1, sortedAndFiltered[0]?.count || 1);
  const isSingleItem = sortedAndFiltered.length === 1;
  const showDim = !scopedLoading && !scopedError && sortedAndFiltered.length === 0;

  const podiumItems = useMemo(() => {
    const top = sortedAndFiltered.slice(0, 3);
    const byRank = new Map<number, ProductOverallItem>();
    if (top[0]) byRank.set(1, top[0]);
    if (top[1]) byRank.set(2, top[1]);
    if (top[2]) byRank.set(3, top[2]);

    return [
      { rank: 2, item: byRank.get(2) || null },
      { rank: 1, item: byRank.get(1) || null },
      { rank: 3, item: byRank.get(3) || null },
    ];
  }, [sortedAndFiltered]);

  const donutEntries = useMemo(() => {
    const base = [...sortedAndFiltered].sort((a, b) => b.count - a.count);
    if (base.length === 0) return [] as Array<{ label: string; value: number; color: string }>;
    const top5 = base.slice(0, 5).map((item, idx) => ({
      label: item.name,
      value: item.count,
      color: DONUT_COLORS[idx] || DONUT_COLORS[DONUT_COLORS.length - 1],
    }));
    const other = base.slice(5).reduce((acc, item) => acc + item.count, 0);
    if (other > 0) {
      top5.push({
        label: "Outros",
        value: other,
        color: DONUT_COLORS[5],
      });
    }
    return top5;
  }, [sortedAndFiltered]);

  const donutTotal = useMemo(() => donutEntries.reduce((acc, item) => acc + item.value, 0), [donutEntries]);

  function goPrev() {
    setPage((current) => Math.max(1, current - 1));
  }

  function goNext() {
    setPage((current) => Math.min(totalPages, current + 1));
  }

  const rootClass = `${showHeader ? "settings-shell" : "products-scope-shell"} reveal ${isSingleItem ? "products-overall-single" : ""}`;

  return (
    <section className={rootClass} id={showHeader ? "products-overview" : undefined}>
      {showHeader ? (
        <div className="section-inner">
          <div className="section-header">
            <span className="section-num">01</span>
            <div className="section-title">
              <h2>Produtos procurados</h2>
              <p>
                {useApiData
                  ? "Consolidado de todos os produtos mencionados em atendimentos salvos."
                  : `Visão do dia selecionado (${selectedDate || "-"}) com produtos detectados.`}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <article className="settings-card products-overall-summary-card">
        <div className="products-overall-summary">
          <div className="products-overall-stat">
            <div className="products-overall-stat-value">{summary.totalProducts}</div>
            <div className="products-overall-stat-label">Produtos</div>
          </div>
          <div className="products-overall-stat">
            <div className="products-overall-stat-value">{summary.totalQuantity}</div>
            <div className="products-overall-stat-label">Quantidade total</div>
          </div>
        </div>
      </article>

      <article className={`settings-card ${showDim ? "data-dim" : ""}`} id="products-ranking">
        <div className="settings-card-head">Top Produtos</div>
        <div className="settings-card-body">
          {scopedLoading ? <p className="empty-state">Carregando produtos...</p> : null}
          {!scopedLoading && scopedError ? <p className="empty-state">{scopedError}</p> : null}
          {!scopedLoading && !scopedError && showDim ? <p className="empty-state">Ainda não há produtos mapeados no consolidado.</p> : null}
          {!scopedLoading && !scopedError && !showDim ? (
            <div className="products-overall-podium">
              {podiumItems.map(({ item, rank }) => (
                <article
                  className={`products-overall-podium-card rank-${rank} ${rank === 1 ? "is-primary" : ""} ${item ? "" : "is-placeholder"}`}
                  key={`podium-slot-${rank}`}
                >
                  <div className="products-overall-medal">
                    {rank === 1 ? "\u{1F947}" : rank === 2 ? "\u{1F948}" : "\u{1F949}"}
                  </div>
                  <span className="products-overall-podium-rank">#{rank}</span>
                  <h4>{item?.name || "Sem dados"}</h4>
                  <div className="products-overall-podium-stats">
                    <span>
                      <strong>{item?.count ?? "-"}</strong>
                      <small>qtd.</small>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </article>

      <article className={`settings-card ${showDim ? "data-dim" : ""}`}>
        <div className="settings-card-head">Ranking Geral</div>
        <div className="settings-card-body">
          {!showDim ? (
            <div className="products-overall-filters">
              <input
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                className="products-overall-search"
                placeholder="Buscar produto..."
              />
              <select
                value={sortMode}
                onChange={(event) => {
                  setSortMode(event.target.value as SortMode);
                  setPage(1);
                }}
                className="products-overall-sort"
              >
                <option value="count">Ordenar por: Quantidade</option>
                <option value="name">Ordenar por: Nome (A-Z)</option>
              </select>
              <span className="products-overall-filter-count">
                Mostrando {pagedItems.length} de {sortedAndFiltered.length}
              </span>
            </div>
          ) : null}

          {sortedAndFiltered.length === 0 ? (
            <p className="empty-state">Nenhum produto encontrado com os filtros atuais.</p>
          ) : (
            <div
              ref={rankingListRef}
              className={`products-overall-list viewport-table ${rankingListProgress > 0 ? "is-entered" : ""}`}
            >
              <header className="products-overall-head">
                <span>#</span>
                <span>Produto procurado</span>
                <span>Quantidade</span>
              </header>
              {pagedItems.map((item, idx) => {
                const absoluteRank = (safePage - 1) * PER_PAGE + idx + 1;
                const widthPercent = Math.max(3, Math.round((item.count / maxCount) * 100));
                const animatedWidthPercent = Math.round(widthPercent * rankingListProgress);
                const toneClass = isSingleItem
                  ? "tone-default"
                  : absoluteRank === 1
                    ? "tone-1"
                    : absoluteRank === 2
                      ? "tone-2"
                      : absoluteRank === 3
                        ? "tone-3"
                        : "tone-default";
                return (
                  <article className="products-overall-row" key={`row-${item.name}-${absoluteRank}`}>
                    <div className={`products-overall-rank ${toneClass}`}>{absoluteRank}</div>
                    <div className="products-overall-main">
                      <h4>{item.name}</h4>
                      <div className="products-overall-bar-track">
                        <span className={`products-overall-bar-fill ${toneClass}`} style={{ width: `${animatedWidthPercent}%` }} />
                      </div>
                    </div>
                    <div className="products-overall-cell products-overall-cell-count">{item.count}</div>
                  </article>
                );
              })}
            </div>
          )}

          {totalPages > 1 ? (
            <div className="products-overall-pagination">
              <button type="button" className="btn btn-sm" onClick={goPrev} disabled={safePage <= 1}>
                Anterior
              </button>
              <span>
                Página {safePage} de {totalPages}
              </span>
              <button type="button" className="btn btn-sm" onClick={goNext} disabled={safePage >= totalPages}>
                Próxima
              </button>
            </div>
          ) : null}
        </div>
      </article>

      <section className={`products-overall-charts ${showDim ? "data-dim" : ""}`} id="products-charts">
        <article className="settings-card" ref={donutChartRef}>
          <div className="settings-card-body">
            <h3 className="products-overall-chart-title">Proporção por Quantidade</h3>
            {donutEntries.length === 0 || donutTotal <= 0 ? (
              <p className="empty-state">Sem dados para exibir.</p>
            ) : (
              <div className="products-overall-donut-wrap">
                <svg viewBox="0 0 220 220" className="products-overall-donut">
                  {donutEntries.length === 1 ? (
                    (() => {
                      const radius = 64;
                      const circ = 2 * Math.PI * radius;
                      const len = circ * donutProgress;
                      return (
                        <circle
                          cx="110"
                          cy="110"
                          r={radius}
                          stroke={donutEntries[0].color}
                          strokeWidth={38}
                          fill="none"
                          strokeDasharray={`${len} ${circ}`}
                          transform="rotate(-90 110 110)"
                        />
                      );
                    })()
                  ) : (
                    (() => {
                      let acc = 0;
                      return donutEntries.map((entry, idx) => {
                        const slice = (entry.value / donutTotal) * 360;
                        const start = acc;
                        const end = acc + slice;
                        acc = end;
                        const animatedStart = start * donutProgress;
                        const animatedEnd = end * donutProgress;
                        return (
                          <path
                            key={`slice-${entry.label}-${idx}`}
                            d={describeArc(110, 110, 64, animatedStart, animatedEnd)}
                            stroke={entry.color}
                            strokeWidth={38}
                            fill="none"
                            strokeLinecap="butt"
                          />
                        );
                      });
                    })()
                  )}
                  <circle cx="110" cy="110" r="46" fill="var(--branco)" />
                </svg>
                <div className="products-overall-donut-legend">
                  {donutEntries.map((entry) => (
                    <div className="products-overall-donut-item" key={`legend-${entry.label}`}>
                      <span className="products-overall-donut-dot" style={{ backgroundColor: entry.color }} />
                      <span className="products-overall-donut-label">{entry.label}</span>
                      <strong className="products-overall-donut-value">{entry.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </article>
      </section>
    </section>
  );
}
