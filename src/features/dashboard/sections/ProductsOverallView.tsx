import { useEffect, useMemo, useState } from "react";
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

export function ProductsOverallView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<ProductsOverallResponse>({ items: [], totalRuns: 0 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiGet<ProductsOverallResponse>("/api/products/overall?limit=300")
      .then((payload) => {
        if (cancelled) return;
        setData({
          items: Array.isArray(payload?.items) ? payload.items : [],
          totalRuns: Number(payload?.totalRuns || 0),
        });
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
  }, []);

  const topThree = useMemo(() => data.items.slice(0, 3), [data.items]);
  const hasProducts = data.items.length > 0;
  const showDim = !hasProducts;

  return (
    <section className="settings-shell reveal" id="products-overall">
      <div className="section-inner">
        <div className="section-header">
          <span className="section-num">01</span>
          <div className="section-title">
            <h2>Produtos (Visão Geral)</h2>
            <p>Ranking consolidado de produtos mapeados em todas as execuções salvas.</p>
          </div>
        </div>
      </div>

      <article className={`settings-card ${showDim ? "data-dim" : ""}`}>
        <div className="settings-card-head">Resumo</div>
        <div className="settings-card-body">
          <p>
            <strong>{data.items.length}</strong> produto(s) identificado(s) em <strong>{data.totalRuns}</strong> execução(ões).
          </p>
          {topThree.length > 0 ? (
            <p>
              Top 3: {topThree.map((item) => item.name).join(" • ")}
            </p>
          ) : null}
        </div>
      </article>

      <article className={`settings-card ${showDim ? "data-dim" : ""}`}>
        <div className="settings-card-head">Ranking Geral</div>
        <div className="settings-card-body">
          {loading ? <p className="empty-state">Carregando produtos...</p> : null}
          {!loading && error ? <p className="empty-state">{error}</p> : null}
          {!loading && !error && data.items.length === 0 ? (
            <p className="empty-state">Nenhum produto identificado até o momento.</p>
          ) : null}

          {!loading && !error && data.items.length > 0 ? (
            <div className="report-list-animated">
              {data.items.map((item, index) => (
                <article className="report-card" key={`${item.name}-${index}`}>
                  <span className="report-card-dot" style={{ background: "var(--azul)" }} />
                  <div className="report-card-content">
                    <h4>
                      #{index + 1} {item.name}
                    </h4>
                    <p>
                      <strong>Ocorrências:</strong> {item.count}
                    </p>
                    <p>
                      <strong>Contatos únicos:</strong> {item.contacts}
                    </p>
                    <p>
                      <strong>Dias com ocorrência:</strong> {item.days}
                    </p>
                    <p>
                      <strong>Última ocorrência:</strong> {item.lastSeenDate || "-"}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      </article>
    </section>
  );
}
