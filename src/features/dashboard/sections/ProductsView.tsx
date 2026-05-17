import type { InsightItem } from "../../../types";
import type { ProductDemandItem } from "../shared/types";

interface ProductsViewProps {
  items: ProductDemandItem[];
  selectedDate: string;
  informationalInsights: InsightItem[];
  showHeader?: boolean;
}

export function ProductsView({ items, selectedDate, informationalInsights, showHeader = true }: ProductsViewProps) {
  const hasProducts = items.length > 0;
  const hasInformational = informationalInsights.length > 0;
  const rootClass = showHeader ? "settings-shell reveal" : "analysis-content-shell reveal";

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
        </div>
        <div className="metrics-block-body">
          {!hasInformational ? (
            <p className="empty-state">Nenhum insight informativo disponível para este período.</p>
          ) : (
            <div className="report-list-animated">
              {informationalInsights.map((item) => (
                <article className="report-card" key={item.id}>
                  <span className="report-card-dot" style={{ background: "var(--azul-soft)" }} />
                  <div className="report-card-content">
                    <h4>{item.contact_name}</h4>
                    <p>{item.summary}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
