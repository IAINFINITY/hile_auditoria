import { useCallback, useEffect, useRef, useState } from "react";
import { resolveCurrentBreadcrumb } from "./shell/helpers";
import { ShellSidebar } from "./shell/ShellSidebar";
import { ShellTopbar } from "./shell/ShellTopbar";
import type { ShellNavigationProps, ShellOpenSections, ShellSectionKey } from "./shell/types";

const DEFAULT_OPEN_SECTIONS: ShellOpenSections = {
  dashboard: true,
  analysis: false,
  attendants: false,
  dissatisfaction: false,
  clients: false,
  products: false,
  logs: false,
  settings: false,
};

export function ShellNavigation({
  activeView,
  activeSubNavKey = "",
  navClass,
  onNavigate,
  onOpenSettings,
  onOpenDashboard,
  onOpenClients,
  onOpenAnalysis,
  onOpenAttendants,
  onOpenDissatisfaction,
  onOpenProducts,
  onOpenLogs,
  onNavigateAnalysis,
  onNavigateAttendants,
  onNavigateDissatisfaction,
  onNavigateClients,
  onNavigateProducts,
  onNavigateLogs,
  onNavigateSettings,
  currentUser,
  onLogout,
  notificationState,
  onClearNotifications,
  onOpenView,
}: ShellNavigationProps) {
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [openSections, setOpenSections] = useState<ShellOpenSections>(DEFAULT_OPEN_SECTIONS);
  const notifyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notifyOpen) return;
    function handleClick(e: globalThis.MouseEvent) {
      if (notifyRef.current && !notifyRef.current.contains(e.target as Node)) {
        setNotifyOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [notifyOpen]);

  const handleNotifyClick = useCallback(() => {
    setNotifyOpen((value) => !value);
  }, []);

  const handleClearAndClose = useCallback(() => {
    onClearNotifications();
    setNotifyOpen(false);
  }, [onClearNotifications]);

  const handleNotifyItemClick = useCallback(
    (view: "clients" | "logs") => {
      onOpenView(view);
      handleClearAndClose();
    },
    [handleClearAndClose, onOpenView],
  );

  const currentBreadcrumb = resolveCurrentBreadcrumb(activeView, navClass);

  const toggleSection = useCallback((section: ShellSectionKey) => {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  }, []);

  const openSection = useCallback((section: ShellSectionKey) => {
    setOpenSections((current) => ({ ...current, [section]: true }));
  }, []);

  return (
    <>
      <ShellSidebar
        activeView={activeView}
        activeSubNavKey={activeSubNavKey}
        navClass={navClass}
        openSections={openSections}
        currentUser={currentUser}
        onLogout={onLogout}
        onNavigate={onNavigate}
        onOpenDashboard={onOpenDashboard}
        onOpenAnalysis={onOpenAnalysis}
        onOpenAttendants={onOpenAttendants}
        onOpenDissatisfaction={onOpenDissatisfaction}
        onOpenClients={onOpenClients}
        onOpenProducts={onOpenProducts}
        onOpenLogs={onOpenLogs}
        onOpenSettings={onOpenSettings}
        onNavigateAnalysis={onNavigateAnalysis}
        onNavigateAttendants={onNavigateAttendants}
        onNavigateDissatisfaction={onNavigateDissatisfaction}
        onNavigateClients={onNavigateClients}
        onNavigateProducts={onNavigateProducts}
        onNavigateLogs={onNavigateLogs}
        onNavigateSettings={onNavigateSettings}
        toggleSection={toggleSection}
        openSection={openSection}
      />

      <ShellTopbar
        currentBreadcrumb={currentBreadcrumb}
        notificationState={notificationState}
        notifyOpen={notifyOpen}
        onToggleNotify={handleNotifyClick}
        onClearAndClose={handleClearAndClose}
        onNotifyItemClick={handleNotifyItemClick}
        notifyRef={notifyRef}
      />
    </>
  );
}
