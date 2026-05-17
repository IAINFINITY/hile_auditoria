import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "@/lib/api";

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
};

type SortMode = "count" | "contacts" | "days" | "name";

const PRODUCTS_OVERALL_REVALIDATE_MS = 5 * 60 * 1000;
const PRODUCTS_OVERALL_CACHE_VERSION = "v2";
const PER_PAGE = 10;
const DONUT_COLORS = ["#0066cc", "#0a2b5c", "#e8a838", "#5a6f8a", "#9ea6b4", "#cd7f4b"];
const BAR_COLORS = ["#0066cc", "#0a2b5c", "#e8a838", "#5a6f8a", "#9ea6b4", "#cd7f4b"];

function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

export function ProductsOverallView({ refreshHint = null }: ProductsOverallViewProps) {
  const cacheKey = `hile_products_overall_cache_${PRODUCTS_OVERALL_CACHE_VERSION}`;
  const fetchMetaKey = `hile_products_overall_fetch_meta_${PRODUCTS_OVERALL_CACHE_VERSION}`;
  const handledRefreshHintRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<ProductsOverallResponse>({ items: [], totalRuns: 0 });
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("count");
  const [page, setPage] = useState(1);

  useEffect(() => {
    try {
      const cachedRaw = localStorage.getItem(cacheKey);
      if (!cachedRaw) return;
      const cached = JSON.parse(cachedRaw) as ProductsOverallResponse;
      if (!cached || !Array.isArray(cached.items)) return;
      setData({
        items: cached.items,
        totalRuns: Number(cached.totalRuns || 0),
      });
      setLoading(false);
    } catch {
      // cache invalido
    }
  }, [cacheKey]);

  useEffect(() => {
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
  }, [cacheKey, fetchMetaKey, refreshHint]);

  const summary = useMemo(() => {
    const totalOccurrences = data.items.reduce((acc, item) => acc + Number(item.count || 0), 0);
    const totalContacts = data.items.reduce((acc, item) => acc + Number(item.contacts || 0), 0);
    const totalDays = data.items.reduce((acc, item) => acc + Number(item.days || 0), 0);
    return {
      totalProducts: data.items.length,
      totalOccurrences,
      totalContacts,
      totalDays,
      totalRuns: data.totalRuns,
    };
  }, [data.items, data.totalRuns]);

  const sortedAndFiltered = useMemo(() => {
    const q = normalizeText(query);
    const list = data.items.filter((item) => !q || normalizeText(item.name).includes(q));
    return [...list].sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name, "pt-BR");
      if (sortMode === "contacts") return b.contacts - a.contacts || b.count - a.count;
      if (sortMode === "days") return b.days - a.days || b.count - a.count;
      return b.count - a.count || b.contacts - a.contacts;
    });
  }, [data.items, query, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sortedAndFiltered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [query, sortMode]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * PER_PAGE;
    return sortedAndFiltered.slice(start, start + PER_PAGE);
  }, [safePage, sortedAndFiltered]);

  const maxCount = Math.max(1, sortedAndFiltered[0]?.count || 1);
  const isSingleItem = sortedAndFiltered.length === 1;
  const showDim = !loading && !error && sortedAndFiltered.length === 0;

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

  const barsTop = useMemo(() => sortedAndFiltered.slice(0, 10), [sortedAndFiltered]);

  const donutEntries = useMemo(() => {
    const base = [...sortedAndFiltered].sort((a, b) => b.contacts - a.contacts);
    if (base.length === 0) return [] as Array<{ label: string; value: number; color: string }>;
    const top5 = base.slice(0, 5).map((item, idx) => ({
      label: item.name,
      value: item.contacts,
      color: DONUT_COLORS[idx] || DONUT_COLORS[DONUT_COLORS.length - 1],
    }));
    const other = base.slice(5).reduce((acc, item) => acc + item.contacts, 0);
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

  return (
    <section className={`settings-shell reveal ${isSingleItem ? "products-overall-single" : ""}`} id="products-overview">
      <div className="section-inner">
        <div className="section-header">
          <span className="section-num">01</span>
          <div className="section-title">
            <h2>Produtos mais procurados</h2>
            <p>Consolidado de todos os produtos mencionados em todas as execuções salvas.</p>
          </div>
        </div>
      </div>

      <article className="settings-card products-overall-summary-card">
        <div className="products-overall-summary">
          <div className="products-overall-stat">
            <div className="products-overall-stat-value">{summary.totalProducts}</div>
            <div className="products-overall-stat-label">Produtos</div>
          </div>
          <div className="products-overall-stat">
            <div className="products-overall-stat-value">{summary.totalOccurrences}</div>
            <div className="products-overall-stat-label">Ocorrências</div>
          </div>
          <div className="products-overall-stat">
            <div className="products-overall-stat-value">{summary.totalContacts}</div>
            <div className="products-overall-stat-label">Contatos únicos</div>
          </div>
          <div className="products-overall-stat">
            <div className="products-overall-stat-value">{summary.totalDays}</div>
            <div className="products-overall-stat-label">Dias com dados</div>
          </div>
          <div className="products-overall-stat">
            <div className="products-overall-stat-value">{summary.totalRuns}</div>
            <div className="products-overall-stat-label">Execuções</div>
          </div>
        </div>
      </article>

      <article className={`settings-card ${showDim ? "data-dim" : ""}`} id="products-ranking">
        <div className="settings-card-head">Top Produtos</div>
        <div className="settings-card-body">
          {loading ? <p className="empty-state">Carregando produtos...</p> : null}
          {!loading && error ? <p className="empty-state">{error}</p> : null}
          {!loading && !error ? (
            <div className="products-overall-podium">
              {podiumItems.map(({ item, rank }) => (
                <article
                  className={`products-overall-podium-card rank-${rank} ${rank === 1 ? "is-primary" : ""} ${item ? "" : "is-placeholder"}`}
                  key={`podium-slot-${rank}`}
                >
                  <div className="products-overall-medal">{rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"}</div>
                  <span className="products-overall-podium-rank">#{rank}</span>
                  <h4>{item?.name || "Sem dados"}</h4>
                  <div className="products-overall-podium-stats">
                    <span>
                      <strong>{item?.count ?? "-"}</strong>
                      <small>ocorr.</small>
                    </span>
                    <span>
                      <strong>{item?.contacts ?? "-"}</strong>
                      <small>contatos</small>
                    </span>
                    <span>
                      <strong>{item?.days ?? "-"}</strong>
                      <small>dias</small>
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
          <div className="products-overall-filters">
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="products-overall-search"
              placeholder="Buscar produto..."
            />
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="products-overall-sort"
            >
              <option value="count">Ordenar por: Ocorrências</option>
              <option value="contacts">Ordenar por: Contatos</option>
              <option value="days">Ordenar por: Dias com ocorrência</option>
              <option value="name">Ordenar por: Nome (A-Z)</option>
            </select>
            <span className="products-overall-filter-count">
              Mostrando {pagedItems.length} de {sortedAndFiltered.length}
            </span>
          </div>

          {sortedAndFiltered.length === 0 ? (
            <p className="empty-state">Nenhum produto encontrado com os filtros atuais.</p>
          ) : (
            <div className="products-overall-list">
              <header className="products-overall-head">
                <span>#</span>
                <span>Produto</span>
                <span>Ocorr.</span>
                <span>Contatos</span>
                <span>Dias</span>
                <span>Última</span>
              </header>
              {pagedItems.map((item, idx) => {
                const absoluteRank = (safePage - 1) * PER_PAGE + idx + 1;
                const widthPercent = Math.max(3, Math.round((item.count / maxCount) * 100));
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
                        <span className={`products-overall-bar-fill ${toneClass}`} style={{ width: `${widthPercent}%` }} />
                      </div>
                    </div>
                    <div className="products-overall-cell products-overall-cell-count">{item.count}</div>
                    <div className="products-overall-cell products-overall-cell-contacts">{item.contacts}</div>
                    <div className="products-overall-cell products-overall-cell-days">{item.days}</div>
                    <div className="products-overall-cell products-overall-cell-last products-overall-cell-muted">{item.lastSeenDate || "-"}</div>
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
        <article className="settings-card">
          <div className="settings-card-body">
            <h3 className="products-overall-chart-title">Distribuição por Ocorrências</h3>
            {barsTop.length === 0 ? (
              <p className="empty-state">Sem dados para exibir.</p>
            ) : (
              <div className="products-overall-bars">
                {barsTop.map((item, index) => {
                  const widthPercent = Math.max(4, Math.round((item.count / maxCount) * 100));
                  const barColor = isSingleItem ? "#0066cc" : BAR_COLORS[index % BAR_COLORS.length];
                  return (
                    <div className="products-overall-bars-row" key={`bar-${item.name}`}>
                      <div className="products-overall-bars-meta">
                        <span>{item.name}</span>
                        <strong>{item.count}</strong>
                      </div>
                      <div className="products-overall-bar-track">
                        <span className="products-overall-bar-fill" style={{ width: `${widthPercent}%`, backgroundColor: barColor }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-body">
            <h3 className="products-overall-chart-title">Proporção por Contatos Únicos</h3>
            {donutEntries.length === 0 || donutTotal <= 0 ? (
              <p className="empty-state">Sem dados para exibir.</p>
            ) : (
              <div className="products-overall-donut-wrap">
                <svg viewBox="0 0 220 220" className="products-overall-donut">
                  {donutEntries.length === 1 ? (
                    <circle
                      cx="110"
                      cy="110"
                      r="64"
                      stroke={donutEntries[0].color}
                      strokeWidth={38}
                      fill="none"
                    />
                  ) : (
                    (() => {
                      let acc = 0;
                      return donutEntries.map((entry, idx) => {
                        const slice = (entry.value / donutTotal) * 360;
                        const start = acc;
                        const end = acc + slice;
                        acc = end;
                        return (
                          <path
                            key={`slice-${entry.label}-${idx}`}
                            d={describeArc(110, 110, 64, start, end)}
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


