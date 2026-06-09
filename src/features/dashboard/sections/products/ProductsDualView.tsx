import { useState } from "react";
import type { InsightItem } from "../../../../types";
import type { OwnerScope, ProductDemandItem } from "../../shared/types";
import { HilePill, HilePillRow, HileSectionShell, HileSurfaceCard } from "../../shared/ui/HilePrimitives";
import { ProductsOverallView } from "./ProductsOverallView";

interface ProductsDualViewProps {
  selectedDate: string;
  dayItems: ProductDemandItem[];
  refreshHint?: string | null;
  informationalInsights: InsightItem[];
  ownerScope: OwnerScope;
  onSetOwnerScope: (scope: OwnerScope) => void;
}

type ProductsScope = "day" | "overall";

function ownerScopeLabel(scope: OwnerScope): string {
  if (scope === "ia") return "IA";
  if (scope === "suellen") return "Comercial Suellen";
  if (scope === "samuel") return "Comercial Samuel";
  return "Todos";
}

export function ProductsDualView({
  selectedDate,
  dayItems,
  refreshHint,
  ownerScope,
  onSetOwnerScope,
}: ProductsDualViewProps) {
  const [scope, setScope] = useState<ProductsScope>("day");
  const [scopeAnimationSeed, setScopeAnimationSeed] = useState(0);
  const ownerLabel = ownerScopeLabel(ownerScope);

  return (
    <section className="settings-shell reveal" id="products-overview">
      <div className="section-inner">
        <HileSectionShell
          eyebrow="01"
          title="Produtos"
          description={
            scope === "day"
              ? `Visão do dia selecionado (${selectedDate}) para ${ownerLabel}.`
              : `Visão total consolidada dos atendimentos salvos para ${ownerLabel}.`
          }
        >
          <div className="hile-section-stack">
            <HileSurfaceCard
              title="Escopo dos produtos"
              description="Alterne entre leitura diária e consolidada, mantendo o filtro por responsável."
              tone="accent"
            >
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

              <div className="btn-group" style={{ marginTop: "10px" }}>
                <button type="button" className={`gap-chip ${ownerScope === "all" ? "active" : ""}`} onClick={() => onSetOwnerScope("all")}>
                  Todos
                </button>
                <button type="button" className={`gap-chip ${ownerScope === "ia" ? "active" : ""}`} onClick={() => onSetOwnerScope("ia")}>
                  IA
                </button>
                <button type="button" className={`gap-chip ${ownerScope === "suellen" ? "active" : ""}`} onClick={() => onSetOwnerScope("suellen")}>
                  Suellen
                </button>
                <button type="button" className={`gap-chip ${ownerScope === "samuel" ? "active" : ""}`} onClick={() => onSetOwnerScope("samuel")}>
                  Samuel
                </button>
              </div>
            </HileSurfaceCard>

            <HileSurfaceCard title="Leitura ativa" description="Resumo rapido do escopo aplicado no momento." tone="soft">
              <HilePillRow>
                <HilePill active>{scope === "day" ? "Produtos do dia" : "Produtos total"}</HilePill>
                <HilePill tone="ghost">Owner: {ownerLabel}</HilePill>
                <HilePill tone="ghost">{scope === "day" ? `Data: ${selectedDate}` : "Consolidado salvo"}</HilePill>
              </HilePillRow>
            </HileSurfaceCard>

            <div className="scope-switch-animated" key={`products-scope-${scope}-${scopeAnimationSeed}`}>
              <ProductsOverallView
                key={`products-overall-${scope}-${ownerScope}-${selectedDate}`}
                showHeader={false}
                refreshHint={refreshHint}
                scope={scope === "day" ? "day" : "overall"}
                dayItems={scope === "day" ? dayItems : []}
                selectedDate={selectedDate}
                ownerScope={ownerScope}
              />
            </div>
          </div>
        </HileSectionShell>
      </div>
    </section>
  );
}
