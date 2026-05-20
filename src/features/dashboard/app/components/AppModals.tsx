interface AppModalsProps {
  showConfirmModal: boolean;
  showLogoutConfirmModal: boolean;
  isDashboardView: boolean;
  selectedDateHasSavedReport: boolean;
  onCancelConfirmRun: () => void;
  onConfirmRun: () => void;
  onCancelLogout: () => void;
  onConfirmLogout: () => void;
}

export function AppModals({
  showConfirmModal,
  showLogoutConfirmModal,
  isDashboardView,
  selectedDateHasSavedReport,
  onCancelConfirmRun,
  onConfirmRun,
  onCancelLogout,
  onConfirmLogout,
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
