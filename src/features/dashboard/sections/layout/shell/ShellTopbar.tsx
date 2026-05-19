import { FiBell, FiMenu } from "react-icons/fi";
import type { NotificationState } from "@/features/dashboard/hooks/useNotifications";
import { formatNotifyTime } from "./helpers";

interface ShellTopbarProps {
  currentBreadcrumb: string;
  notificationState: NotificationState;
  notifyOpen: boolean;
  onToggleNotify: () => void;
  onClearAndClose: () => void;
  onNotifyItemClick: (view: "clients" | "logs") => void;
  notifyRef: React.RefObject<HTMLDivElement | null>;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function ShellTopbar({
  currentBreadcrumb,
  notificationState,
  notifyOpen,
  onToggleNotify,
  onClearAndClose,
  onNotifyItemClick,
  notifyRef,
  sidebarCollapsed,
  onToggleSidebar,
}: ShellTopbarProps) {
  return (
    <header className="app-topbar">
      <div className="topbar-breadcrumb">
        <button
          type="button"
          className="topbar-sidebar-toggle"
          aria-label={sidebarCollapsed ? "Mostrar sidebar" : "Ocultar sidebar"}
          onClick={onToggleSidebar}
        >
          <FiMenu aria-hidden="true" />
        </button>
        <span>Dashboard</span>
        <span className="sep">&gt;</span>
        <strong>{currentBreadcrumb}</strong>
      </div>
      <div className="topbar-actions">
        <div ref={notifyRef} style={{ position: "relative" }}>
          <button type="button" className="topbar-notify" aria-label="Notificacoes" onClick={onToggleNotify}>
            <FiBell className="topbar-notify-icon" aria-hidden="true" />
            {notificationState.total > 0 ? <span className="topbar-notify-badge">{notificationState.total}</span> : null}
          </button>
          {notifyOpen ? (
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
              <div
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--line)",
                  fontWeight: 700,
                  fontSize: "var(--fs-small)",
                  color: "var(--navy)",
                }}
              >
                Notificacoes
              </div>
              {notificationState.total === 0 ? (
                <div style={{ padding: "16px 14px", fontSize: "var(--fs-small)", color: "var(--muted)" }}>
                  Nenhuma notificacao nova.
                </div>
              ) : (
                <div style={{ display: "grid" }}>
                  {notificationState.events.map((event, index) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onNotifyItemClick(event.targetView)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 14px",
                        border: 0,
                        background: "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: "var(--fs-small)",
                        color: "var(--navy)",
                        borderBottom: index < notificationState.events.length - 1 ? "1px solid var(--line)" : 0,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: event.kind === "client" ? "var(--ok)" : "var(--azul)",
                          flexShrink: 0,
                        }}
                      />
                      <span>
                        {event.title}
                        {formatNotifyTime(event.at) ? (
                          <small style={{ display: "block", color: "var(--muted)" }}>{formatNotifyTime(event.at)}</small>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {notificationState.total > 0 ? (
                <button
                  type="button"
                  onClick={onClearAndClose}
                  style={{
                    width: "100%",
                    padding: "8px 14px",
                    border: 0,
                    borderTop: "1px solid var(--line)",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: "var(--fs-small)",
                    color: "var(--muted)",
                    textAlign: "center",
                  }}
                >
                  Limpar notificacoes
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
