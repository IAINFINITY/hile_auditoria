import type { AttendantPerformanceSummary } from "../shared/types";

interface AttendantsViewProps {
  selectedDate: string;
  summary: AttendantPerformanceSummary;
}

function formatSeconds(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "-";
  return `${Number(value).toFixed(1)}s`;
}

export function AttendantsView({ selectedDate, summary }: AttendantsViewProps) {
  const hasData = summary.totalAnalyses > 0 || summary.totalMessages > 0 || summary.totalGaps > 0;

  return (
    <section className="settings-shell reveal">
      <div className="section-inner" id="attendants-overview">
        <div className="section-header">
          <span className="section-num">01</span>
          <div className="section-title">
            <h2>Desempenho de Atendentes</h2>
            <p>Consolidado por responsável para a data selecionada: {selectedDate}.</p>
          </div>
        </div>
      </div>

      <article className={`settings-card ${hasData ? "" : "data-dim"}`}>
        <div className="settings-card-head">Resumo</div>
        <div className="settings-card-body logs-grid">
          <p>
            <strong>Análises atribuídas:</strong> {summary.totalAnalyses}
          </p>
          <p>
            <strong>Mensagens de agente:</strong> {summary.totalMessages}
          </p>
          <p>
            <strong>Gaps totais:</strong> {summary.totalGaps}
          </p>
          <p>
            <strong>Gaps críticos:</strong> {summary.totalCriticalGaps}
          </p>
        </div>
      </article>

      <article className={`settings-card ${hasData ? "" : "data-dim"}`} id="attendants-breakdown">
        <div className="settings-card-head">Por responsável</div>
        <div className="settings-card-body">
          {summary.entries.length === 0 ? (
            <p className="empty-state">Sem dados para o período selecionado.</p>
          ) : (
            <div className="accounts-list">
              {summary.entries.map((entry) => (
                <article className="account-card" key={entry.owner}>
                  <div className="account-card-head">
                    <div>
                      <h3>{entry.ownerLabel}</h3>
                      <p className="k-card-phone">{entry.owner}</p>
                    </div>
                    <span className={`sev-dot ${entry.criticalGapsCount > 0 ? "sev-critical" : entry.gapsCount > 0 ? "sev-high" : "sev-low"}`} />
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
              {summary.entries.map((entry) => (
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
      </article>
    </section>
  );
}

