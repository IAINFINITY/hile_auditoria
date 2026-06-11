import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { useEnterViewport } from "../../hooks/useEnterViewport";
import { HileCardGrid, HileEmptyPanel, HileKpiCard, HilePill, HilePillRow, HileSectionShell, HileSurfaceCard } from "../../shared/ui/HilePrimitives";
import type { AttendantPerformanceSummary, OwnerScope } from "../../shared/types";

interface AttendantsViewProps {
  selectedDate: string;
  summary: AttendantPerformanceSummary;
  refreshHint?: string | null;
  ownerScope: OwnerScope;
  onSetOwnerScope: (scope: OwnerScope) => void;
}

type Scope = "day" | "overall";

interface AttendantsOverallResponse {
  summary: AttendantPerformanceSummary;
}

const EMPTY_SUMMARY: AttendantPerformanceSummary = {
  entries: [],
  totalAnalyses: 0,
  totalMessages: 0,
  totalGaps: 0,
  totalCriticalGaps: 0,
};

function formatSeconds(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "-";
  return `${Number(value).toFixed(1)}s`;
}

function ownerTone(owner: "ia" | "suellen" | "samuel"): "tone-1" | "tone-2" | "tone-3" {
  if (owner === "ia") return "tone-1";
  if (owner === "suellen") return "tone-2";
  return "tone-3";
}

function ownerScopeLabel(scope: OwnerScope): string {
  if (scope === "ia") return "IA";
  if (scope === "suellen") return "Comercial Suellen";
  if (scope === "samuel") return "Comercial Samuel";
  return "Todos";
}

export function AttendantsView({
  selectedDate,
  summary,
  refreshHint = null,
  ownerScope,
  onSetOwnerScope,
}: AttendantsViewProps) {
  const [scope, setScope] = useState<Scope>("day");
  const { rootRef: comparisonTableRef, hasEntered: comparisonTableEntered } = useEnterViewport<HTMLDivElement>();
  const [overallSummary, setOverallSummary] = useState<AttendantPerformanceSummary>(EMPTY_SUMMARY);
  const [overallLoading, setOverallLoading] = useState(false);
  const [overallError, setOverallError] = useState("");

  useEffect(() => {
    if (scope !== "overall") return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setOverallLoading(true);
      setOverallError("");
    });

    apiGet<AttendantsOverallResponse>(`/api/attendants/overall?take=1000&owner=${encodeURIComponent(ownerScope)}`)
      .then((payload) => {
        if (cancelled) return;
        const incoming = payload?.summary;
        setOverallSummary(incoming && Array.isArray(incoming.entries) ? incoming : EMPTY_SUMMARY);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setOverallError(error instanceof Error ? error.message : "Falha ao carregar atendentes (geral).");
        setOverallSummary(EMPTY_SUMMARY);
      })
      .finally(() => {
        if (!cancelled) setOverallLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ownerScope, refreshHint, scope]);

  const dayScopedSummary = useMemo<AttendantPerformanceSummary>(() => {
    const entries = ownerScope === "all" ? summary.entries : summary.entries.filter((item) => item.owner === ownerScope);
    return {
      entries,
      totalAnalyses: entries.reduce((acc, entry) => acc + entry.analysesCount, 0),
      totalMessages: entries.reduce((acc, entry) => acc + entry.messageCountAgent, 0),
      totalGaps: entries.reduce((acc, entry) => acc + entry.gapsCount, 0),
      totalCriticalGaps: entries.reduce((acc, entry) => acc + entry.criticalGapsCount, 0),
    };
  }, [ownerScope, summary.entries]);

  const activeSummary = scope === "overall" ? overallSummary : dayScopedSummary;
  const hasEntries = activeSummary.entries.length > 0;
  const hasData = activeSummary.totalAnalyses > 0 || activeSummary.totalMessages > 0 || activeSummary.totalGaps > 0;
  const maxMessages = Math.max(1, ...activeSummary.entries.map((entry) => Number(entry.messageCountAgent || 0)));
  const maxGaps = Math.max(1, ...activeSummary.entries.map((entry) => Number(entry.gapsCount || 0)));
  const ownerLabel = ownerScopeLabel(ownerScope);

  return (
    <section className="settings-shell reveal">
      <div className="section-inner" id="attendants-overview" style={{ scrollMarginTop: "96px" }}>
        <HileSectionShell
          eyebrow="01"
          title="Desempenho de Atendentes"
          description={
            scope === "day"
              ? `Consolidado por responsável para a data selecionada: ${selectedDate} (${ownerLabel}).`
              : `Consolidado geral por responsável em todas as execuções salvas (${ownerLabel}).`
          }
        >
          <div className="hile-section-stack">
            <HileSurfaceCard
              title="Escopo dos atendentes"
              description="Alterne entre o dia selecionado e o consolidado geral, mantendo o filtro por owner."
              tone="accent"
            >
              <div className="btn-group">
                <button type="button" className={`gap-chip ${scope === "day" ? "active" : ""}`} onClick={() => setScope("day")}>
                  Atendentes do dia
                </button>
                <button type="button" className={`gap-chip ${scope === "overall" ? "active" : ""}`} onClick={() => setScope("overall")}>
                  Atendentes geral
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

            <HileSurfaceCard title="Leitura ativa" description="Resumo rapido do recorte operacional atual." tone="soft">
              <HilePillRow>
                <HilePill active>{scope === "day" ? "Atendentes do dia" : "Atendentes geral"}</HilePill>
                <HilePill tone="ghost">Owner: {ownerLabel}</HilePill>
                <HilePill tone="ghost">{scope === "day" ? `Data: ${selectedDate}` : "Consolidado salvo"}</HilePill>
              </HilePillRow>
            </HileSurfaceCard>

            <HileCardGrid cols={4}>
              <HileKpiCard label="Análises" value={activeSummary.totalAnalyses} hint="Atribuições no escopo atual" tone={activeSummary.totalAnalyses > 0 ? "accent" : "default"} accent="accent" />
              <HileKpiCard label="Mensagens" value={activeSummary.totalMessages} hint="Mensagens de agente" />
              <HileKpiCard label="Gaps" value={activeSummary.totalGaps} hint="Ocorrências identificadas" tone={activeSummary.totalGaps > 0 ? "critical" : "default"} accent={activeSummary.totalGaps > 0 ? "high" : "default"} />
              <HileKpiCard label="Críticos" value={activeSummary.totalCriticalGaps} hint="Gaps de maior severidade" tone={activeSummary.totalCriticalGaps > 0 ? "critical" : "default"} accent={activeSummary.totalCriticalGaps > 0 ? "critical" : "default"} />
            </HileCardGrid>

            <div id="attendants-breakdown" style={{ scrollMarginTop: "96px" }}>
              <HileSurfaceCard title="Indicadores visuais" description="Comparativo rápido de volume de mensagens e gaps por responsável.">
              {scope === "overall" && overallLoading ? (
                <HileEmptyPanel title="Carregando consolidado geral" description="Estamos buscando os dados agregados dos atendentes." />
              ) : scope === "overall" && overallError ? (
                <HileEmptyPanel title="Falha ao carregar atendentes" description={overallError} />
              ) : !hasEntries ? (
                <HileEmptyPanel title="Sem dados para gerar gráficos" description="Não há registros suficientes no período selecionado." />
              ) : (
                <div className="attendants-bars-wrap">
                  <div className="attendants-bars-col">
                    <h4 className="attendants-bars-title">Mensagens por responsável</h4>
                    {activeSummary.entries.map((entry) => {
                      const tone = ownerTone(entry.owner);
                      const width = Math.max(4, Math.round((Number(entry.messageCountAgent || 0) / maxMessages) * 100));
                      return (
                        <article className="attendants-bars-row" key={`msg-${entry.owner}`}>
                          <div className="attendants-bars-meta">
                            <strong>{entry.ownerLabel}</strong>
                            <span>{entry.messageCountAgent}</span>
                          </div>
                          <div className="attendants-bars-track">
                            <span className={`attendants-bars-fill ${tone}`} style={{ width: `${width}%` }} />
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="attendants-bars-col">
                    <h4 className="attendants-bars-title">Gaps por responsável</h4>
                    {activeSummary.entries.map((entry) => {
                      const tone = ownerTone(entry.owner);
                      const width = Math.max(4, Math.round((Number(entry.gapsCount || 0) / maxGaps) * 100));
                      return (
                        <article className="attendants-bars-row" key={`gap-${entry.owner}`}>
                          <div className="attendants-bars-meta">
                            <strong>{entry.ownerLabel}</strong>
                            <span>{entry.gapsCount}</span>
                          </div>
                          <div className="attendants-bars-track">
                            <span className={`attendants-bars-fill ${tone}`} style={{ width: `${width}%` }} />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
            </HileSurfaceCard>
            </div>

            <div id="attendants-comparison" style={{ scrollMarginTop: "96px" }}>
              <HileSurfaceCard title="Por responsável" description="Detalhamento operacional de cada owner dentro do escopo selecionado." tone={hasData ? "default" : "soft"}>
              {scope === "overall" && overallLoading ? (
                <HileEmptyPanel title="Carregando atendentes" description="O detalhamento geral esta sendo preparado." />
              ) : activeSummary.entries.length === 0 ? (
                <HileEmptyPanel title="Sem dados para o período selecionado" description="Quando houver registros válidos, eles aparecerão nesta lista." />
              ) : (
                <div className="accounts-list">
                  {activeSummary.entries.map((entry) => (
                    <article className="account-card" key={entry.owner}>
                      <div className="account-card-head">
                        <div>
                          <h3>{entry.ownerLabel}</h3>
                          <p className="k-card-phone">{entry.owner}</p>
                        </div>
                        <span className={`sev-dot ${entry.criticalGapsCount > 0 ? "sev-critical" : entry.gapsCount > 0 ? "sev-high" : "sev-low"}`} />
                      </div>
                      <div className="account-grid">
                        <p><strong>Análises:</strong> {entry.analysesCount}</p>
                        <p><strong>Contatos:</strong> {entry.contactsCount}</p>
                        <p><strong>Conversas:</strong> {entry.conversationsCount}</p>
                        <p><strong>Mensagens:</strong> {entry.messageCountAgent}</p>
                        <p><strong>Gaps:</strong> {entry.gapsCount}</p>
                        <p><strong>Críticos:</strong> {entry.criticalGapsCount}</p>
                        <p><strong>Melhorias:</strong> {entry.improvementsCount}</p>
                        <p><strong>Média resp.:</strong> {formatSeconds(entry.avgResponseSec)}</p>
                        <p><strong>Max. resp.:</strong> {formatSeconds(entry.maxResponseSec)}</p>
                        <p><strong>Amostras:</strong> {entry.responseSamples}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </HileSurfaceCard>

            <HileSurfaceCard title="Comparativo rápido" description="Tabela compacta para comparar volume e tempo de resposta entre owners." tone={hasData ? "default" : "soft"}>
              {!hasEntries ? (
                <HileEmptyPanel title="Sem dados comparativos" description="Não há informações suficientes para montar a tabela neste momento." />
              ) : (
                <div ref={comparisonTableRef} className={`viewport-table ${comparisonTableEntered ? "is-entered" : ""}`}>
                  <table className="risk-table">
                    <thead>
                      <tr>
                        <th>Responsável</th>
                        <th>Mensagens</th>
                        <th>Gaps</th>
                        <th>Críticos</th>
                        <th>Média</th>
                        <th>Max.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSummary.entries.map((entry) => (
                        <tr key={`table-${entry.owner}`}>
                          <td>{entry.ownerLabel}</td>
                          <td>{entry.messageCountAgent}</td>
                          <td>{entry.gapsCount}</td>
                          <td>{entry.criticalGapsCount}</td>
                          <td>{formatSeconds(entry.avgResponseSec)}</td>
                          <td>{formatSeconds(entry.maxResponseSec)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </HileSurfaceCard>
            </div>
          </div>
        </HileSectionShell>
      </div>
    </section>
  );
}


