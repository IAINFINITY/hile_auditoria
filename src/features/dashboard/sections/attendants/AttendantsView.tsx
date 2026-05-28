import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { useEnterViewport } from "../../hooks/useEnterViewport";
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
  const hasData =
    activeSummary.totalAnalyses > 0 || activeSummary.totalMessages > 0 || activeSummary.totalGaps > 0;
  const maxMessages = Math.max(1, ...activeSummary.entries.map((entry) => Number(entry.messageCountAgent || 0)));
  const maxGaps = Math.max(1, ...activeSummary.entries.map((entry) => Number(entry.gapsCount || 0)));

  return (
    <section className="settings-shell reveal">
      <div className="section-inner" id="attendants-overview">
        <div className="section-header">
          <span className="section-num">01</span>
          <div className="section-title">
            <h2>Desempenho de Atendentes</h2>
            <p>
              {scope === "day"
                ? `Consolidado por responsável para a data selecionada: ${selectedDate}.`
                : "Consolidado geral por responsável em todas as execuções salvas."}
            </p>
          </div>
        </div>
      </div>

      <article className="settings-card">
        <div className="settings-card-head">Escopo dos atendentes</div>
        <div className="settings-card-body">
          <div className="btn-group">
            <button
              type="button"
              className={`gap-chip ${scope === "day" ? "active" : ""}`}
              onClick={() => setScope("day")}
            >
              Atendentes do dia
            </button>
            <button
              type="button"
              className={`gap-chip ${scope === "overall" ? "active" : ""}`}
              onClick={() => setScope("overall")}
            >
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
            <button
              type="button"
              className={`gap-chip ${ownerScope === "suellen" ? "active" : ""}`}
              onClick={() => onSetOwnerScope("suellen")}
            >
              Suellen
            </button>
            <button
              type="button"
              className={`gap-chip ${ownerScope === "samuel" ? "active" : ""}`}
              onClick={() => onSetOwnerScope("samuel")}
            >
              Samuel
            </button>
          </div>
        </div>
      </article>

      <article className={`settings-card ${hasData ? "" : "data-dim"}`}>
        <div className="settings-card-head">Resumo</div>
        <div className="settings-card-body logs-grid">
          {scope === "overall" && overallLoading ? <p>Carregando consolidado geral...</p> : null}
          {scope === "overall" && !overallLoading && overallError ? <p>{overallError}</p> : null}
          <p>
            <strong>Análises atribuídas:</strong> {activeSummary.totalAnalyses}
          </p>
          <p>
            <strong>Mensagens de agente:</strong> {activeSummary.totalMessages}
          </p>
          <p>
            <strong>Gaps totais:</strong> {activeSummary.totalGaps}
          </p>
          <p>
            <strong>Gaps críticos:</strong> {activeSummary.totalCriticalGaps}
          </p>
        </div>
      </article>

      <article className={`settings-card ${hasData ? "" : "data-dim"}`} id="attendants-charts">
        <div className="settings-card-head">Indicadores visuais</div>
        <div className="settings-card-body">
          {!hasEntries ? (
            <p className="empty-state">Sem dados para gerar gráficos no período selecionado.</p>
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
        </div>
      </article>

      <article className={`settings-card ${hasData ? "" : "data-dim"}`} id="attendants-breakdown">
        <div className="settings-card-head">Por responsável</div>
        <div className="settings-card-body">
          {scope === "overall" && overallLoading ? <p className="empty-state">Carregando atendentes...</p> : null}
          {!overallLoading && activeSummary.entries.length === 0 ? (
            <p className="empty-state">Sem dados para o período selecionado.</p>
          ) : (
            <div className="accounts-list">
              {activeSummary.entries.map((entry) => (
                <article className="account-card" key={entry.owner}>
                  <div className="account-card-head">
                    <div>
                      <h3>{entry.ownerLabel}</h3>
                      <p className="k-card-phone">{entry.owner}</p>
                    </div>
                    <span
                      className={`sev-dot ${
                        entry.criticalGapsCount > 0 ? "sev-critical" : entry.gapsCount > 0 ? "sev-high" : "sev-low"
                      }`}
                    />
                  </div>
                  <div className="account-grid">
                    <p>
                      <strong>Análises:</strong> {entry.analysesCount}
                    </p>
                    <p>
                      <strong>Contatos:</strong> {entry.contactsCount}
                    </p>
                    <p>
                      <strong>Conversas:</strong> {entry.conversationsCount}
                    </p>
                    <p>
                      <strong>Mensagens:</strong> {entry.messageCountAgent}
                    </p>
                    <p>
                      <strong>Gaps:</strong> {entry.gapsCount}
                    </p>
                    <p>
                      <strong>Críticos:</strong> {entry.criticalGapsCount}
                    </p>
                    <p>
                      <strong>Melhorias:</strong> {entry.improvementsCount}
                    </p>
                    <p>
                      <strong>Média resp.:</strong> {formatSeconds(entry.avgResponseSec)}
                    </p>
                    <p>
                      <strong>Máx. resp.:</strong> {formatSeconds(entry.maxResponseSec)}
                    </p>
                    <p>
                      <strong>Amostras:</strong> {entry.responseSamples}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </article>

      <article className={`settings-card ${hasData ? "" : "data-dim"}`} id="attendants-comparison">
        <div className="settings-card-head">Comparativo rápido</div>
        <div className="settings-card-body">
          <div
            ref={comparisonTableRef}
            className={`viewport-table ${comparisonTableEntered ? "is-entered" : ""}`}
          >
          <table className="risk-table">
            <thead>
              <tr>
                <th>Responsável</th>
                <th>Mensagens</th>
                <th>Gaps</th>
                <th>Críticos</th>
                <th>Média</th>
                <th>Máx.</th>
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
        </div>
      </article>
    </section>
  );
}
