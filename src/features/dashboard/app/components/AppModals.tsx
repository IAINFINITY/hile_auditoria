interface AppModalsProps {
  showConfirmModal: boolean;
  showRunWarningModal: boolean;
  showRunFailureModal: boolean;
  showLogoutConfirmModal: boolean;
  isDashboardView: boolean;
  selectedDateHasSavedReport: boolean;
  runFailureMessage: string;
  onCancelConfirmRun: () => void;
  onConfirmRun: () => void;
  onCloseRunWarning: () => void;
  onCloseRunFailure: () => void;
  onCancelLogout: () => void;
  onConfirmLogout: () => void;
  onOpenLogs: () => void;
}

export function AppModals({
  showConfirmModal,
  showRunWarningModal,
  showRunFailureModal,
  showLogoutConfirmModal,
  isDashboardView,
  selectedDateHasSavedReport,
  runFailureMessage,
  onCancelConfirmRun,
  onConfirmRun,
  onCloseRunWarning,
  onCloseRunFailure,
  onCancelLogout,
  onConfirmLogout,
  onOpenLogs,
}: AppModalsProps) {
  return (
    <>
      {showConfirmModal && isDashboardView ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirmOverviewTitle">
          <div className="modal-card">
            <h3 id="confirmOverviewTitle">Executar overview agora?</h3>
            <p>Vamos checar conexões, buscar conversas do dia, rodar análise e atualizar o relatório.</p>
            <p>Esta execução vai consolidar os dados do dia e atualizar o relatório salvo para a data selecionada.</p>
            {selectedDateHasSavedReport ? (
              <p style={{ color: "var(--critical)" }}>
                Já existe relatório salvo para essa data. Se continuar, o novo relatório vai substituir o anterior.
              </p>
            ) : null}
            <div className="modal-actions">
              <button className="btn btn-sm" onClick={onCancelConfirmRun}>
                Cancelar
              </button>
              <button className="btn btn-primary btn-sm" onClick={onConfirmRun}>
                Confirmar e executar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showRunWarningModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="runWarningTitle">
          <div className="modal-card">
            <h3 id="runWarningTitle">Execução em andamento</h3>
            <p>Não feche, recarregue ou saia desta página enquanto o overview estiver processando.</p>
            <p>Se a sessão for interrompida durante o processamento, o reprocessamento pode falhar.</p>
            <div className="modal-actions">
              <button className="btn btn-primary btn-sm" onClick={onCloseRunWarning}>
                Entendi
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showRunFailureModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="runFailureTitle">
          <div className="modal-card">
            <h3 id="runFailureTitle">Execução interrompida</h3>
            <p>A execução terminou com erro ou foi interrompida antes da finalização completa.</p>
            {runFailureMessage ? <p style={{ color: "var(--critical)" }}>{runFailureMessage}</p> : null}
            <div className="modal-actions">
              <button className="btn btn-sm" onClick={onCloseRunFailure}>
                Fechar
              </button>
              <button className="btn btn-primary btn-sm" onClick={onOpenLogs}>
                Ver logs
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showLogoutConfirmModal ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirmLogoutTitle">
          <div className="modal-card">
            <h3 id="confirmLogoutTitle">Sair da conta?</h3>
            <p>Você deseja realmente encerrar sua sessão agora?</p>
            <div className="modal-actions">
              <button className="btn btn-sm" onClick={onCancelLogout}>
                Cancelar
              </button>
              <button className="btn btn-primary btn-sm" onClick={onConfirmLogout}>
                Sair da conta
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
