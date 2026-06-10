import { FiBell, FiMenu } from "react-icons/fi";
import type { NotificationState } from "@/features/dashboard/hooks/useNotifications";
import { formatNotifyTime } from "./helpers";

interface ShellTopbarProps {
  currentBreadcrumb: string;
  notificationState: NotificationState;
  notifyOpen: boolean;
  onToggleNotify: () => void;
  onClearAndClose: () => void;
  onNotifyItemClick: (eventId: string, view: "clients" | "logs") => void;
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
      <div className="topbar-breadcrumb-wrap">
        <div className="topbar-breadcrumb">
          <button
            type="button"
            className="topbar-sidebar-toggle"
            aria-label={sidebarCollapsed ? "Mostrar sidebar" : "Ocultar sidebar"}
            onClick={onToggleSidebar}
          >
            <FiMenu aria-hidden="true" />
          </button>
          <span>Plataforma Hilê</span>
          <span className="sep">&gt;</span>
          <strong>{currentBreadcrumb}</strong>
        </div>
      </div>

      <div className="topbar-actions">
        <div ref={notifyRef} className="topbar-notify-wrap">
          <button type="button" className="topbar-notify" aria-label="Notificações" onClick={onToggleNotify}>
            <FiBell className="topbar-notify-icon" aria-hidden="true" />
            {notificationState.total > 0 ? <span className="topbar-notify-badge">{notificationState.total}</span> : null}
          </button>

          {notifyOpen ? (
            <div className="topbar-notify-panel">
              <div className="topbar-notify-panel-head">Notificações</div>

              {notificationState.total === 0 ? (
                <div className="topbar-notify-empty">Nenhuma notificação nova.</div>
              ) : (
                <div className="topbar-notify-list">
                  {notificationState.events.map((event, index) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onNotifyItemClick(event.id, event.targetView)}
                      className="topbar-notify-item"
                      style={index < notificationState.events.length - 1 ? undefined : { borderBottom: 0 }}
                    >
                      <span className={`topbar-notify-dot ${event.kind === "client" ? "client" : "system"}`} />
                      <span className="topbar-notify-copy">
                        {event.title}
                        {formatNotifyTime(event.at) ? <small>{formatNotifyTime(event.at)}</small> : null}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {notificationState.total > 0 ? (
                <button type="button" onClick={onClearAndClose} className="topbar-notify-clear">
                  Limpar notificações
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
