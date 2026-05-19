import { useMemo, useState } from "react";
import type { InsightItem } from "../../../types";
import type { ProductDemandItem } from "../shared/types";
import { ProductsOverallView } from "./ProductsOverallView";
import { toTitleCaseName } from "../hooks/controller/common";

interface ProductsDualViewProps {
  selectedDate: string;
  dayItems: ProductDemandItem[];
  refreshHint?: string | null;
  informationalInsights: InsightItem[];
}

type ProductsScope = "day" | "overall";

export function ProductsDualView({
  selectedDate,
  dayItems,
  refreshHint,
  informationalInsights,
}: ProductsDualViewProps) {
  const [scope, setScope] = useState<ProductsScope>("day");

  const summary = useMemo(() => {
    const totalProducts = dayItems.length;
    const totalOccurrences = dayItems.reduce((acc, item) => acc + Number(item.count || 0), 0);
    const totalContacts = dayItems.reduce((acc, item) => acc + Number(item.contacts || 0), 0);
    return { totalProducts, totalOccurrences, totalContacts };
  }, [dayItems]);

  return (
    <section className="settings-shell reveal" id="products-overview">
      <div className="section-inner">
        <div className="section-header">
          <span className="section-num">01</span>
          <div className="section-title">
            <h2>Produtos</h2>
            <p>
              {scope === "day"
                ? `Visão do dia selecionado (${selectedDate}).`
                : "Visão total consolidada de todas as execuções salvas."}
            </p>
          </div>
        </div>
      </div>

      <article className="settings-card">
        <div className="settings-card-body">
          <div className="btn-group">
            <button type="button" className={`gap-chip ${scope === "day" ? "active" : ""}`} onClick={() => setScope("day")}>
              Produtos do dia
            </button>
            <button type="button" className={`gap-chip ${scope === "overall" ? "active" : ""}`} onClick={() => setScope("overall")}>
              Produtos total
            </button>
          </div>
        </div>
      </article>

      {scope === "overall" ? (
        <ProductsOverallView refreshHint={refreshHint} />
      ) : (
        <div className="analysis-content-shell reveal">
          <article className={`settings-card ${summary.totalProducts > 0 ? "" : "data-dim"}`}>
            <div className="settings-card-head">Resumo do dia</div>
            <div className="settings-card-body dissatisfaction-kpis">
              <p><strong>Produtos:</strong> {summary.totalProducts}</p>
              <p><strong>Ocorrências:</strong> {summary.totalOccurrences}</p>
              <p><strong>Contatos únicos:</strong> {summary.totalContacts}</p>
            </div>
          </article>

          <article className={`settings-card ${dayItems.length > 0 ? "" : "data-dim"}`} id="products-ranking">
            <div className="settings-card-head">Ranking do dia</div>
            <div className="settings-card-body">
              {dayItems.length === 0 ? (
                <p className="empty-state">Ainda não há produtos mapeados neste dia.</p>
              ) : (
                <div className="report-list-animated">
                  {dayItems.map((item, index) => (
                    <article className="report-card" key={`${item.name}-${index + 1}`}>
                      <span className="report-card-dot" />
                      <div className="report-card-content">
                        <h4>{item.name}</h4>
                        <p><strong>Ocorrências:</strong> {item.count}</p>
                        <p><strong>Clientes únicos:</strong> {item.contacts}</p>
                        <p>
                          <strong>Usuários:</strong>{" "}
                          {item.contactNames.length > 0
                            ? item.contactNames.map((name) => toTitleCaseName(name)).join(" • ")
                            : "-"}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </article>

          <article className={`settings-card ${informationalInsights.length > 0 ? "" : "data-dim"}`} id="products-charts">
            <div className="settings-card-head">Contexto do dia</div>
            <div className="settings-card-body">
              {informationalInsights.length === 0 ? (
                <p className="empty-state">Sem contexto informativo para o dia selecionado.</p>
              ) : (
                <div className="report-list-animated">
                  {informationalInsights.slice(0, 8).map((item) => (
                    <article className="report-card" key={item.id}>
                      <span className="report-card-dot" />
                      <div className="report-card-content">
                        <h4>{toTitleCaseName(item.contact_name)}</h4>
                        <p>{item.summary}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

