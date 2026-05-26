import { useState } from "react";
import type { InsightItem } from "../../../../types";
import type { ProductDemandItem } from "../../shared/types";
import { ProductsOverallView } from "./ProductsOverallView";

interface ProductsDualViewProps {
  selectedDate: string;
  dayItems: ProductDemandItem[];
  refreshHint?: string | null;
  informationalInsights: InsightItem[];
}

type ProductsScope = "day" | "overall";

export function ProductsDualView({ selectedDate, dayItems, refreshHint }: ProductsDualViewProps) {
  const [scope, setScope] = useState<ProductsScope>("day");
  const [scopeAnimationSeed, setScopeAnimationSeed] = useState(0);

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
                : "Visão total consolidada de todos os atendimentos salvos."}
            </p>
          </div>
        </div>
      </div>

      <article className="settings-card">
        <div className="settings-card-head">Escopo dos produtos</div>
        <div className="settings-card-body">
          <div className="btn-group">
            <button
              type="button"
              className={`gap-chip ${scope === "day" ? "active" : ""}`}
              onClick={() => {
                setScopeAnimationSeed((value) => value + 1);
                setScope("day");
              }}
            >
              Produtos do dia
            </button>
            <button
              type="button"
              className={`gap-chip ${scope === "overall" ? "active" : ""}`}
              onClick={() => {
                setScopeAnimationSeed((value) => value + 1);
                setScope("overall");
              }}
            >
              Produtos total
            </button>
          </div>
        </div>
      </article>

      <div className="scope-switch-animated" key={`products-scope-${scope}-${scopeAnimationSeed}`}>
        <ProductsOverallView
          showHeader={false}
          refreshHint={refreshHint}
          scope={scope === "day" ? "day" : "overall"}
          dayItems={scope === "day" ? dayItems : []}
          selectedDate={selectedDate}
        />
      </div>
    </section>
  );
}
