export function SettingsView() {
  return (
    <div className="settings-shell">
      <div className="settings-header">
        <h1>Configurações</h1>
        <p>Ajustes de perfil, segurança e preferências do dashboard.</p>
      </div>

      <section className="settings-card">
        <div className="settings-card-head">Perfil</div>
        <div className="settings-card-body">
          <div className="settings-field">
            <label>Nome completo</label>
            <input type="text" defaultValue="Francisco" placeholder="Seu nome" />
          </div>
          <div className="settings-field">
            <label>Email</label>
            <input type="email" defaultValue="francisco@hile.com.br" placeholder="seu@email.com" />
          </div>
          <div className="settings-field">
            <label>Cargo</label>
            <input type="text" defaultValue="Administrador" placeholder="Seu cargo" />
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-head">Segurança</div>
        <div className="settings-card-body">
          <div className="settings-field">
            <label>Senha atual</label>
            <input type="password" placeholder="••••••••" />
          </div>
          <div className="settings-field">
            <label>Nova senha</label>
            <input type="password" placeholder="Mínimo 8 caracteres" />
          </div>
          <div className="settings-field">
            <label>Confirmar nova senha</label>
            <input type="password" placeholder="Repita a nova senha" />
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-head">Preferências</div>
        <div className="settings-card-body">
          <div className="settings-toggle-row">
            <span>Notificações por email</span>
            <span className="settings-toggle-pill on" />
          </div>
          <div className="settings-toggle-row">
            <span>Relatório automático ao final do dia</span>
            <span className="settings-toggle-pill on" />
          </div>
          <div className="settings-toggle-row">
            <span>Alertas de gaps críticos no email</span>
            <span className="settings-toggle-pill" />
          </div>
        </div>
      </section>
    </div>
  );
}
