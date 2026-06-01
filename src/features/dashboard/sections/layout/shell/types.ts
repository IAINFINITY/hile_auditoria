import type { NotificationState } from "@/features/dashboard/hooks/useNotifications";

export type ShellView =
  | "dashboard"
  | "clients"
  | "analysis"
  | "attendants"
  | "dissatisfaction"
  | "products"
  | "logs"
  | "superadmin"
  | "settings";

export type ShellSectionKey = ShellView;

export interface ShellNavigationProps {
  activeView: ShellView;
  activeSubNavKey?: string;
  navClass: (section: string) => string;
  onNavigate: (section: string) => void;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  onOpenClients: () => void;
  onOpenAnalysis: () => void;
  onOpenAttendants: () => void;
  onOpenDissatisfaction: () => void;
  onOpenProducts: () => void;
  onOpenLogs: () => void;
  onOpenSuperadmin: () => void;
  onNavigateAnalysis: (section: "analysis-overview" | "analysis-movimentacao" | "analysis-conteudo") => void;
  onNavigateAttendants: (section: "attendants-overview" | "attendants-breakdown" | "attendants-comparison") => void;
  onNavigateDissatisfaction: (section: "dissatisfaction-overview" | "dissatisfaction-filters" | "dissatisfaction-list") => void;
  onNavigateClients: (section: "clients-filtros" | "clients-kanban") => void;
  onNavigateProducts: (section: "products-overview" | "products-ranking" | "products-charts") => void;
  onNavigateLogs: (section: "logs-saude" | "logs-execucao" | "logs-recentes") => void;
  onNavigateSuperadmin: (section: "superadmin-accounts") => void;
  onNavigateSettings: (section: "settings-profile" | "settings-security" | "settings-preferences") => void;
  currentUser: {
    name: string;
    email: string;
    role: string;
  };
  onLogout: () => void;
  notificationState: NotificationState;
  onClearNotifications: () => void;
  onClearNotification: (eventId: string) => void;
  onOpenView: (view: "clients" | "logs" | "superadmin") => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export type ShellOpenSections = Record<ShellSectionKey, boolean>;
