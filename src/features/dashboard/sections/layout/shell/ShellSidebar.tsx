import Image from "next/image";
import type { IconType } from "react-icons";
import {
  FiActivity,
  FiAlertTriangle,
  FiBarChart2,
  FiBell,
  FiBox,
  FiCheckCircle,
  FiChevronDown,
  FiChevronRight,
  FiClipboard,
  FiClock,
  FiFileText,
  FiFrown,
  FiHome,
  FiLayers,
  FiPieChart,
  FiSettings,
  FiShield,
  FiUsers,
  FiZap,
} from "react-icons/fi";
import { sideItemClass, subItemClass } from "./helpers";
import type { ShellOpenSections, ShellSectionKey, ShellView } from "./types";

interface ShellSidebarProps {
  activeView: ShellView;
  activeSubNavKey: string;
  navClass: (section: string) => string;
  openSections: ShellOpenSections;
  currentUser: {
    name: string;
    email: string;
    role: string;
  };
  onLogout: () => void;
  onNavigate: (section: string) => void;
  onOpenDashboard: () => void;
  onOpenAnalysis: () => void;
  onOpenAttendants: () => void;
  onOpenDissatisfaction: () => void;
  onOpenClients: () => void;
  onOpenProducts: () => void;
  onOpenLogs: () => void;
  onOpenSuperadmin: () => void;
  onOpenSettings: () => void;
  onNavigateAnalysis: (section: "analysis-overview" | "analysis-movimentacao" | "analysis-conteudo") => void;
  onNavigateAttendants: (section: "attendants-overview" | "attendants-breakdown" | "attendants-comparison") => void;
  onNavigateDissatisfaction: (section: "dissatisfaction-overview" | "dissatisfaction-filters" | "dissatisfaction-list") => void;
  onNavigateClients: (section: "clients-filtros" | "clients-kanban") => void;
  onNavigateProducts: (section: "products-overview" | "products-ranking" | "products-charts") => void;
  onNavigateLogs: (section: "logs-saude" | "logs-execucao" | "logs-recentes") => void;
  onNavigateSuperadmin: (section: "superadmin-accounts") => void;
  onNavigateSettings: (section: "settings-profile" | "settings-security" | "settings-preferences") => void;
  toggleSection: (section: ShellSectionKey) => void;
  openSection: (section: ShellSectionKey) => void;
}

interface SidebarSubItem {
  key: string;
  label: string;
  icon: IconType;
  isActive: boolean;
  onClick: () => void;
}

interface SidebarSection {
  key: ShellSectionKey;
  label: string;
  icon: IconType;
  subItems: SidebarSubItem[];
  onOpen: () => void;
}

interface SidebarGroup {
  label: string;
  sections: SidebarSection[];
}

function renderSubItem(item: SidebarSubItem) {
  const Icon = item.icon;
  return (
    <button type="button" className={subItemClass(item.isActive ? item.key : "", item.key)} onClick={item.onClick} key={item.key}>
      <span className="side-sub-dot" />
      <span className="side-sub-icon">
        <Icon />
      </span>
      {item.label}
    </button>
  );
}

export function ShellSidebar({
  activeView,
  activeSubNavKey,
  navClass,
  openSections,
  currentUser,
  onLogout,
  onNavigate,
  onOpenDashboard,
  onOpenAnalysis,
  onOpenAttendants,
  onOpenDissatisfaction,
  onOpenClients,
  onOpenProducts,
  onOpenLogs,
  onOpenSuperadmin,
  onOpenSettings,
  onNavigateAnalysis,
  onNavigateAttendants,
  onNavigateDissatisfaction,
  onNavigateClients,
  onNavigateProducts,
  onNavigateLogs,
  onNavigateSuperadmin,
  onNavigateSettings,
  toggleSection,
  openSection,
}: ShellSidebarProps) {
  const isSuperadmin = String(currentUser.role || "")
    .trim()
    .toLowerCase()
    .includes("superadmin");

  const userInitial = String(currentUser.name || currentUser.email || "U").trim().charAt(0).toUpperCase() || "U";

  const sections: SidebarGroup[] = [
    {
      label: "Visão Geral",
      sections: [
        {
          key: "dashboard",
          label: "Dashboard",
          icon: FiHome,
          onOpen: () => {
            openSection("dashboard");
            onOpenDashboard();
          },
          subItems: [
            { key: "inicio", label: "Metricas", icon: FiBarChart2, isActive: navClass("inicio") === "active", onClick: () => onNavigate("inicio") },
            { key: "gaps", label: "Gaps", icon: FiAlertTriangle, isActive: navClass("gaps") === "active", onClick: () => onNavigate("gaps") },
            { key: "insights", label: "Insights", icon: FiZap, isActive: navClass("insights") === "active", onClick: () => onNavigate("insights") },
          ],
        },
        {
          key: "analysis",
          label: "Análise Geral",
          icon: FiPieChart,
          onOpen: () => {
            openSection("analysis");
            onOpenAnalysis();
          },
          subItems: [
            { key: "analysis-overview", label: "Análise do Dia", icon: FiLayers, isActive: activeSubNavKey === "analysis-overview", onClick: () => onNavigateAnalysis("analysis-overview") },
            { key: "analysis-movimentacao", label: "Movimentação", icon: FiBarChart2, isActive: activeSubNavKey === "analysis-movimentacao", onClick: () => onNavigateAnalysis("analysis-movimentacao") },
            { key: "analysis-conteudo", label: "Produtos e Contexto", icon: FiFileText, isActive: activeSubNavKey === "analysis-conteudo", onClick: () => onNavigateAnalysis("analysis-conteudo") },
          ],
        },
        {
          key: "attendants",
          label: "Atendentes",
          icon: FiActivity,
          onOpen: () => {
            openSection("attendants");
            onOpenAttendants();
          },
          subItems: [
            { key: "attendants-overview", label: "Panorama", icon: FiLayers, isActive: activeSubNavKey === "attendants-overview", onClick: () => onNavigateAttendants("attendants-overview") },
            { key: "attendants-breakdown", label: "Por responsável", icon: FiUsers, isActive: activeSubNavKey === "attendants-breakdown", onClick: () => onNavigateAttendants("attendants-breakdown") },
            { key: "attendants-comparison", label: "Comparativo", icon: FiBarChart2, isActive: activeSubNavKey === "attendants-comparison", onClick: () => onNavigateAttendants("attendants-comparison") },
          ],
        },
        {
          key: "dissatisfaction",
          label: "Insatisfacao",
          icon: FiFrown,
          onOpen: () => {
            openSection("dissatisfaction");
            onOpenDissatisfaction();
          },
          subItems: [
            { key: "dissatisfaction-overview", label: "Panorama", icon: FiLayers, isActive: activeSubNavKey === "dissatisfaction-overview", onClick: () => onNavigateDissatisfaction("dissatisfaction-overview") },
            { key: "dissatisfaction-filters", label: "Filtros", icon: FiBarChart2, isActive: activeSubNavKey === "dissatisfaction-filters", onClick: () => onNavigateDissatisfaction("dissatisfaction-filters") },
            { key: "dissatisfaction-list", label: "Ocorrências", icon: FiFileText, isActive: activeSubNavKey === "dissatisfaction-list", onClick: () => onNavigateDissatisfaction("dissatisfaction-list") },
          ],
        },
      ],
    },
    {
      label: "Operacao",
      sections: [
        {
          key: "clients",
          label: "Clientes",
          icon: FiUsers,
          onOpen: () => {
            openSection("clients");
            onOpenClients();
          },
          subItems: [
            { key: "clients-filtros", label: "Filtros", icon: FiLayers, isActive: activeSubNavKey === "clients-filtros", onClick: () => onNavigateClients("clients-filtros") },
            { key: "clients-kanban", label: "Kanban", icon: FiBarChart2, isActive: activeSubNavKey === "clients-kanban", onClick: () => onNavigateClients("clients-kanban") },
          ],
        },
        {
          key: "products",
          label: "Produtos",
          icon: FiBox,
          onOpen: () => {
            openSection("products");
            onOpenProducts();
          },
          subItems: [
            { key: "products-overview", label: "Visão Geral", icon: FiLayers, isActive: activeSubNavKey === "products-overview", onClick: () => onNavigateProducts("products-overview") },
            { key: "products-ranking", label: "Ranking", icon: FiFileText, isActive: activeSubNavKey === "products-ranking", onClick: () => onNavigateProducts("products-ranking") },
            { key: "products-charts", label: "Gráficos", icon: FiBarChart2, isActive: activeSubNavKey === "products-charts", onClick: () => onNavigateProducts("products-charts") },
          ],
        },
        {
          key: "logs",
          label: "Logs",
          icon: FiClipboard,
          onOpen: () => {
            openSection("logs");
            onOpenLogs();
          },
          subItems: [
            { key: "logs-saude", label: "Saúde", icon: FiCheckCircle, isActive: activeSubNavKey === "logs-saude", onClick: () => onNavigateLogs("logs-saude") },
            { key: "logs-execucao", label: "Execução", icon: FiClock, isActive: activeSubNavKey === "logs-execucao", onClick: () => onNavigateLogs("logs-execucao") },
            { key: "logs-recentes", label: "Histórico", icon: FiFileText, isActive: activeSubNavKey === "logs-recentes", onClick: () => onNavigateLogs("logs-recentes") },
          ],
        },
      ],
    },
    {
      label: "Administracao",
      sections: [
        ...(isSuperadmin
          ? [
              {
                key: "superadmin" as const,
                label: "Superadmin",
                icon: FiShield,
                onOpen: () => {
                  openSection("superadmin");
                  onOpenSuperadmin();
                },
                subItems: [
                  { key: "superadmin-accounts", label: "Contas", icon: FiUsers, isActive: activeSubNavKey === "superadmin-accounts", onClick: () => onNavigateSuperadmin("superadmin-accounts") },
                ],
              },
            ]
          : []),
        {
          key: "settings",
          label: "Configurações",
          icon: FiSettings,
          onOpen: () => {
            openSection("settings");
            onOpenSettings();
          },
          subItems: [
            { key: "settings-profile", label: "Perfil", icon: FiUsers, isActive: activeSubNavKey === "settings-profile", onClick: () => onNavigateSettings("settings-profile") },
            { key: "settings-security", label: "Segurança", icon: FiSettings, isActive: activeSubNavKey === "settings-security", onClick: () => onNavigateSettings("settings-security") },
            { key: "settings-preferences", label: "Preferências", icon: FiBell, isActive: activeSubNavKey === "settings-preferences", onClick: () => onNavigateSettings("settings-preferences") },
          ],
        },
      ],
    },
  ];

  return (
    <aside className="app-sidebar">
      <button type="button" className="side-brand" onClick={onOpenDashboard}>
        <span className="side-brand-logo">
          <Image src="/faviconV2.png" alt="Hile" width={28} height={28} />
        </span>
        <span className="side-brand-copy">
          <span className="side-brand-kicker">Hile Atendimento</span>
          <span className="side-brand-text">
            Hile <span className="side-brand-text-expand">Auditoria</span>
          </span>
        </span>
      </button>

      <nav className="side-nav">
        {sections.map((group) => (
          <div key={group.label}>
            <p className="side-group-label">{group.label}</p>
            {group.sections.map((section) => {
              const SectionIcon = section.icon;
              const isOpen = openSections[section.key];
              const isActive = activeView === section.key;
              return (
                <div key={section.key}>
                  <div className={`side-item-row ${isActive ? "active" : ""}`}>
                    <button type="button" className={sideItemClass(isActive)} onClick={section.onOpen}>
                      <span className="side-item-icon" aria-hidden="true">
                        <SectionIcon />
                      </span>
                      <span>{section.label}</span>
                    </button>
                    <button
                      type="button"
                      className="side-item-toggle"
                      aria-label={isOpen ? `Recolher ${section.label}` : `Expandir ${section.label}`}
                      onClick={() => toggleSection(section.key)}
                    >
                      {isOpen ? <FiChevronDown /> : <FiChevronRight />}
                    </button>
                  </div>
                  {isOpen ? <div className="side-subnav">{section.subItems.map(renderSubItem)}</div> : null}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="side-account">
        <span className="side-account-avatar">{userInitial}</span>
        <div className="side-account-text">
          <strong>{currentUser.name}</strong>
          <span>{currentUser.email}</span>
          <small>{currentUser.role}</small>
        </div>
        <button type="button" className="side-account-logout" onClick={onLogout}>
          Sair
        </button>
      </div>
    </aside>
  );
}
