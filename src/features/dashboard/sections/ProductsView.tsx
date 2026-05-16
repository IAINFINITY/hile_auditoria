import type { ProductDemandItem } from "../shared/types";

interface ProductsViewProps {
  items: ProductDemandItem[];
  selectedDate: string;
}

export function ProductsView({ items, selectedDate }: ProductsViewProps) {
  return (
    <section className="settings-shell reveal">
      <header className="settings-header">
        <h2>Produtos Procurados</h2>
        <p>Leitura consolidada dos produtos citados pelos clientes em {selectedDate}.</p>
      </header>

      <div className="settings-card">
        {items.length === 0 ? (
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
    </section>
  );
}

