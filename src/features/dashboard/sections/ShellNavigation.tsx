import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { BsDiamond } from "react-icons/bs";
import { FiAlertTriangle, FiBarChart2, FiBell, FiBox, FiCheckCircle, FiClock, FiFileText, FiLayers, FiSettings, FiUsers, FiZap } from "react-icons/fi";
import type { NotificationState } from "../hooks/useNotifications";

interface ShellNavigationProps {
  activeView: "dashboard" | "clients" | "analysis" | "products" | "logs" | "settings";
  activeSubNavKey?: string;
  navClass: (section: string) => string;
  onNavigate: (section: string) => void;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  onOpenClients: () => void;
  onOpenAnalysis: () => void;
  onOpenProducts: () => void;
  onOpenLogs: () => void;
  onNavigateAnalysis: (section: "analysis-overview" | "analysis-movimentacao" | "analysis-conteudo") => void;
  onNavigateClients: (section: "clients-filtros" | "clients-kanban") => void;
  onNavigateLogs: (section: "logs-saude" | "logs-execucao" | "logs-recentes") => void;
  onNavigateSettings: (section: "settings-profile" | "settings-security" | "settings-preferences") => void;
  currentUser: {
    name: string;
    email: string;
    role: string;
  };
  onLogout: () => void;
  notificationState: NotificationState;
  onClearNotifications: () => void;
  onOpenView: (view: "clients" | "logs") => void;
}

function sideItemClass(isActive: boolean): string {
  return `side-item ${isActive ? "active" : ""}`;
}

export function ShellNavigation({
  activeView,
  activeSubNavKey = "",
  navClass,
  onNavigate,
  onOpenSettings,
  onOpenDashboard,
  onOpenClients,
  onOpenAnalysis,
  onOpenProducts,
  onOpenLogs,
  onNavigateAnalysis,
  onNavigateClients,
  onNavigateLogs,
  onNavigateSettings,
  currentUser,
  onLogout,
  notificationState,
  onClearNotifications,
  onOpenView,
}: ShellNavigationProps) {
  const [notifyOpen, setNotifyOpen] = useState(false);
  const notifyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notifyOpen) return;
    function handleClick(e: MouseEvent | globalThis.MouseEvent) {
      if (notifyRef.current && !notifyRef.current.contains(e.target as Node)) {
        setNotifyOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [notifyOpen]);

  const handleNotifyClick = useCallback(() => {
    setNotifyOpen((v) => !v);
  }, []);

  const handleClearAndClose = useCallback(() => {
    onClearNotifications();
    setNotifyOpen(false);
  }, [onClearNotifications]);

  function handleNotifyItemClick(view: "clients" | "logs") {
    onOpenView(view);
    handleClearAndClose();
  }

  const sectionLabels: Record<string, string> = {
    inicio: "Métricas do Dia",
    gaps: "Gaps Identificados",
    insights: "Insights de Melhoria",
    relatorio: "Relatório de Auditoria",
  };

  const activeSection = Object.keys(sectionLabels).find((key) => navClass(key) === "active") || "inicio";
  const currentBreadcrumb =
    activeView === "dashboard"
      ? sectionLabels[activeSection]
      : activeView === "clients"
        ? "Clientes"
        : activeView === "analysis"
          ? "Análise Geral do Dia"
        : activeView === "products"
          ? "Produtos (Geral)"
        : activeView === "logs"
          ? "Logs Operacionais"
          : "Configurações";

  function handleSection(section: string, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    onNavigate(section);
  }

  function subItemClass(key: string): string {
    return `side-sub-item ${activeSubNavKey === key ? "active" : ""}`;
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
                <span className="side-sub-icon"><FiBarChart2 /></span>
                Métricas
              </button>
              <button type="button" className={`side-sub-item ${navClass("gaps")}`} onClick={(event) => handleSection("gaps", event)}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiAlertTriangle /></span>
                Gaps
              </button>
              <button type="button" className={`side-sub-item ${navClass("insights")}`} onClick={(event) => handleSection("insights", event)}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiZap /></span>
                Insights
              </button>
              <button type="button" className={`side-sub-item ${navClass("relatorio")}`} onClick={(event) => handleSection("relatorio", event)}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiFileText /></span>
                Relatório
              </button>
            </div>
          ) : null}

          <button type="button" className={sideItemClass(activeView === "analysis")} onClick={onOpenAnalysis}>
            <span className="side-item-icon" aria-hidden="true">
              <FiBarChart2 />
            </span>
            <span>Análise Geral</span>
          </button>
          {activeView === "analysis" ? (
            <div className="side-subnav">
              <button type="button" className={subItemClass("analysis-overview")} onClick={() => onNavigateAnalysis("analysis-overview")}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiLayers /></span>
                Análise do Dia
              </button>
              <button type="button" className={subItemClass("analysis-movimentacao")} onClick={() => onNavigateAnalysis("analysis-movimentacao")}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiBarChart2 /></span>
                Movimentação
              </button>
              <button type="button" className={subItemClass("analysis-conteudo")} onClick={() => onNavigateAnalysis("analysis-conteudo")}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiFileText /></span>
                Produtos e Contexto
              </button>
            </div>
          ) : null}

          <button type="button" className={sideItemClass(activeView === "clients")} onClick={onOpenClients}>
            <span className="side-item-icon" aria-hidden="true">
              <FiUsers />
            </span>
            <span>Clientes</span>
          </button>
          {activeView === "clients" ? (
            <div className="side-subnav">
              <button type="button" className={subItemClass("clients-filtros")} onClick={() => onNavigateClients("clients-filtros")}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiLayers /></span>
                Filtros
              </button>
              <button type="button" className={subItemClass("clients-kanban")} onClick={() => onNavigateClients("clients-kanban")}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiBarChart2 /></span>
                Kanban
              </button>
            </div>
          ) : null}

          <button type="button" className={sideItemClass(activeView === "products")} onClick={onOpenProducts}>
            <span className="side-item-icon" aria-hidden="true">
              <FiBox />
            </span>
            <span>Produtos</span>
          </button>

          <button type="button" className={sideItemClass(activeView === "logs")} onClick={onOpenLogs}>
            <span className="side-item-icon" aria-hidden="true">
              <FiLayers />
            </span>
            <span>Logs</span>
          </button>
          {activeView === "logs" ? (
            <div className="side-subnav">
              <button type="button" className={subItemClass("logs-saude")} onClick={() => onNavigateLogs("logs-saude")}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiCheckCircle /></span>
                Saúde
              </button>
              <button type="button" className={subItemClass("logs-execucao")} onClick={() => onNavigateLogs("logs-execucao")}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiClock /></span>
                Execução
              </button>
              <button type="button" className={subItemClass("logs-recentes")} onClick={() => onNavigateLogs("logs-recentes")}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiFileText /></span>
                Histórico
              </button>
            </div>
          ) : null}

          <button type="button" className={sideItemClass(activeView === "settings")} onClick={onOpenSettings}>
            <span className="side-item-icon" aria-hidden="true">
              <FiSettings />
            </span>
            <span>Configurações</span>
          </button>
          {activeView === "settings" ? (
            <div className="side-subnav">
              <button type="button" className={subItemClass("settings-profile")} onClick={() => onNavigateSettings("settings-profile")}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiUsers /></span>
                Perfil
              </button>
              <button type="button" className={subItemClass("settings-security")} onClick={() => onNavigateSettings("settings-security")}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiSettings /></span>
                Segurança
              </button>
              <button type="button" className={subItemClass("settings-preferences")} onClick={() => onNavigateSettings("settings-preferences")}>
                <span className="side-sub-dot" />
                <span className="side-sub-icon"><FiBell /></span>
                Preferências
              </button>
            </div>
          ) : null}
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
          <div ref={notifyRef} style={{ position: "relative" }}>
            <button type="button" className="topbar-notify" aria-label="Notificações" onClick={handleNotifyClick}>
              <FiBell className="topbar-notify-icon" aria-hidden="true" />
              {notificationState.total > 0 ? (
                <span className="topbar-notify-badge">{notificationState.total}</span>
              ) : null}
            </button>
            {notifyOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  width: 280,
                  background: "#fff",
                  border: "1px solid var(--line)",
                  boxShadow: "0 4px 20px rgba(0,0,0,.1)",
                  zIndex: 1200,
                  padding: 0,
                }}
              >
                <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", fontWeight: 700, fontSize: "var(--fs-small)", color: "var(--navy)" }}>
                  Notificações
                </div>
                {notificationState.total === 0 ? (
                  <div style={{ padding: "16px 14px", fontSize: "var(--fs-small)", color: "var(--muted)" }}>
                    Nenhuma notificação nova.
                  </div>
                ) : (
                  <div style={{ display: "grid" }}>
                    {notificationState.newReport && (
                      <button type="button" onClick={() => handleNotifyItemClick("logs")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: 0, background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "var(--fs-small)", color: "var(--navy)", borderBottom: "1px solid var(--line)" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--azul)", flexShrink: 0 }} />
                        <span>Relatório executado / finalizado</span>
                      </button>
                    )}
                    {notificationState.newLog && (
                      <button type="button" onClick={() => handleNotifyItemClick("logs")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: 0, background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "var(--fs-small)", color: "var(--navy)", borderBottom: "1px solid var(--line)" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--azul)", flexShrink: 0 }} />
                        <span>Log novo</span>
                      </button>
                    )}
                    {notificationState.newClient && (
                      <button type="button" onClick={() => handleNotifyItemClick("clients")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: 0, background: "transparent", cursor: "pointer", textAlign: "left", fontSize: "var(--fs-small)", color: "var(--navy)" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--azul)", flexShrink: 0 }} />
                        <span>Cliente novo</span>
                      </button>
                    )}
                  </div>
                )}
                {notificationState.total > 0 && (
                  <button type="button" onClick={handleClearAndClose} style={{ width: "100%", padding: "8px 14px", border: 0, borderTop: "1px solid var(--line)", background: "transparent", cursor: "pointer", fontSize: "var(--fs-small)", color: "var(--muted)", textAlign: "center" }}>
                    Limpar notificações
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
