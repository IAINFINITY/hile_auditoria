import type { MouseEvent } from "react";
import { BsDiamond } from "react-icons/bs";
import { FiBell, FiSettings } from "react-icons/fi";

interface ShellNavigationProps {
  activeView: "dashboard" | "settings";
  navClass: (section: string) => string;
  onNavigate: (section: string) => void;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  currentUser: {
    name: string;
    email: string;
    role: string;
  };
  onLogout: () => void;
}

function sideItemClass(isActive: boolean): string {
  return `side-item ${isActive ? "active" : ""}`;
}

export function ShellNavigation({
  activeView,
  navClass,
  onNavigate,
  onOpenSettings,
  onOpenDashboard,
  currentUser,
  onLogout,
}: ShellNavigationProps) {
  const sectionLabels: Record<string, string> = {
    inicio: "Métricas do Dia",
    gaps: "Gaps Identificados",
    insights: "Insights de Melhoria",
    movimentacao: "Movimentação",
    relatorio: "Relatório de Auditoria",
  };

  const activeSection = Object.keys(sectionLabels).find((key) => navClass(key) === "active") || "inicio";
  const currentBreadcrumb = activeView === "dashboard" ? sectionLabels[activeSection] : "Configurações";

  function handleSection(section: string, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    onNavigate(section);
  }

  return (
    <>
      <aside className="app-sidebar">
        <button type="button" className="side-brand" onClick={onOpenDashboard}>
          <span className="side-brand-logo">
            <img src="/faviconV2.png" alt="Hilê" />
          </span>
          <span className="side-brand-text">
            Hilê <span className="side-brand-text-expand">Auditoria</span>
          </span>
        </button>

        <nav className="side-nav">
          <button type="button" className={sideItemClass(activeView === "dashboard")} onClick={onOpenDashboard}>
            <span className="side-item-icon" aria-hidden="true">
              <BsDiamond />
            </span>
            <span>Dashboard</span>
          </button>

          {activeView === "dashboard" ? (
            <div className="side-subnav">
              <button type="button" className={`side-sub-item ${navClass("inicio")}`} onClick={(event) => handleSection("inicio", event)}>
                <span className="side-sub-dot" />
                Métricas
              </button>
              <button type="button" className={`side-sub-item ${navClass("gaps")}`} onClick={(event) => handleSection("gaps", event)}>
                <span className="side-sub-dot" />
                Gaps
              </button>
              <button type="button" className={`side-sub-item ${navClass("insights")}`} onClick={(event) => handleSection("insights", event)}>
                <span className="side-sub-dot" />
                Insights
              </button>
              <button
                type="button"
                className={`side-sub-item ${navClass("movimentacao")}`}
                onClick={(event) => handleSection("movimentacao", event)}
              >
                <span className="side-sub-dot" />
                Movimentação
              </button>
              <button type="button" className={`side-sub-item ${navClass("relatorio")}`} onClick={(event) => handleSection("relatorio", event)}>
                <span className="side-sub-dot" />
                Relatório
              </button>
            </div>
          ) : null}

          <button type="button" className={sideItemClass(activeView === "settings")} onClick={onOpenSettings}>
            <span className="side-item-icon" aria-hidden="true">
              <FiSettings />
            </span>
            <span>Configurações</span>
          </button>
        </nav>

        <div className="side-account">
          <span className="side-account-avatar">{currentUser.name.slice(0, 1).toUpperCase()}</span>
          <div className="side-account-text">
            <strong>{currentUser.name}</strong>
            <span>{currentUser.role}</span>
          </div>
          <button type="button" className="side-account-logout" onClick={onLogout}>
            Sair
          </button>
        </div>
      </aside>

      <header className="app-topbar">
        <div className="topbar-breadcrumb">
          <span>Dashboard</span>
          <span className="sep">›</span>
          <strong>{currentBreadcrumb}</strong>
        </div>
        <div className="topbar-actions">
          <button type="button" className="topbar-notify" aria-label="Notificações">
            <FiBell className="topbar-notify-icon" aria-hidden="true" />
            <span className="topbar-notify-badge">4</span>
          </button>
        </div>
      </header>
    </>
  );
}

