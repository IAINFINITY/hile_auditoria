import type { ReportHistoryItem, SystemCheckResponse } from "../../../types";

interface LogsViewProps {
  systemCheck: SystemCheckResponse | null;
  reportHistory: ReportHistoryItem[];
  currentStatus: string;
  selectedDate: string;
}

export function LogsView({ systemCheck, reportHistory, currentStatus, selectedDate }: LogsViewProps) {
  const latestRuns = reportHistory
    .filter((run) => String(run.date_ref || "").trim() === String(selectedDate || "").trim())
    .slice(0, 8);

  return (
    <section className="accounts-shell">
      <header className="accounts-header">
        <h1>Logs Operacionais</h1>
        <p>
          Esta área já está preparada para receber logs detalhados (Chatwoot, Dify, API e notificações). Na próxima etapa,
          conectamos os eventos completos.
        </p>
      </header>

      <article className="settings-card">
        <div className="settings-card-head">Saúde rápida</div>
        <div className="settings-card-body logs-grid">
          <p>
            <strong>Status Chatwoot:</strong> {systemCheck?.chatwoot?.ok ? "OK" : "Aguardando/Erro"}
          </p>
          <p>
            <strong>Status Dify:</strong> {systemCheck?.dify?.ok ? "OK" : "Aguardando/Erro"}
          </p>
          <p>
            <strong>Status geral:</strong> {currentStatus || "Sem execução no momento"}
          </p>
        </div>
      </article>

      <article className="settings-card">
        <div className="settings-card-head">Execuções da data selecionada</div>
        <div className="settings-card-body">
          {latestRuns.length === 0 ? (
            <p className="empty-state">Nenhuma execução salva para {selectedDate}.</p>
          ) : (
            <div className="logs-list">
              {latestRuns.map((run) => (
                <article className="log-item" key={run.id}>
                  <p>
                    <strong>{run.date_ref}</strong> • {run.channel}
                  </p>
                  <p>
                    Status: {run.status} • Processadas: {run.processed}/{run.total_conversations} • Sucesso: {run.success_count} • Falhas: {run.failure_count}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </article>
    </section>
  );
}
