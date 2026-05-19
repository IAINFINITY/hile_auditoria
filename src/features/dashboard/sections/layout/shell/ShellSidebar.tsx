import type { MouseEvent } from "react";
import Image from "next/image";
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
  onOpenSettings: () => void;
  onNavigateAnalysis: (section: "analysis-overview" | "analysis-movimentacao" | "analysis-conteudo") => void;
  onNavigateAttendants: (section: "attendants-overview" | "attendants-breakdown" | "attendants-comparison") => void;
  onNavigateDissatisfaction: (section: "dissatisfaction-overview" | "dissatisfaction-filters" | "dissatisfaction-list") => void;
  onNavigateClients: (section: "clients-filtros" | "clients-kanban") => void;
  onNavigateProducts: (section: "products-overview" | "products-ranking" | "products-charts") => void;
  onNavigateLogs: (section: "logs-saude" | "logs-execucao" | "logs-recentes") => void;
  onNavigateSettings: (section: "settings-profile" | "settings-security" | "settings-preferences") => void;
  toggleSection: (section: ShellSectionKey) => void;
  openSection: (section: ShellSectionKey) => void;
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
  onOpenSettings,
  onNavigateAnalysis,
  onNavigateAttendants,
  onNavigateDissatisfaction,
  onNavigateClients,
  onNavigateProducts,
  onNavigateLogs,
  onNavigateSettings,
  toggleSection,
  openSection,
}: ShellSidebarProps) {
  function handleSection(section: string, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    onNavigate(section);
  }

  const attendantsOpen = openSections.attendants || activeView === "attendants";

  return (
    <aside className="app-sidebar">
      <button type="button" className="side-brand" onClick={onOpenDashboard}>
        <span className="side-brand-logo">
          <Image src="/faviconV2.png" alt="Hilê" width={28} height={28} />
        </span>
        <span className="side-brand-text">
          Hilê <span className="side-brand-text-expand">Auditoria</span>
        </span>
      </button>

      <nav className="side-nav">
        <div className={`side-item-row ${activeView === "dashboard" ? "active" : ""}`}>
          <button
            type="button"
            className={sideItemClass(activeView === "dashboard")}
            onClick={() => {
              openSection("dashboard");
              onOpenDashboard();
            }}
          >
            <span className="side-item-icon" aria-hidden="true">
              <FiHome />
            </span>
            <span>Dashboard</span>
          </button>
          <button
            type="button"
            className="side-item-toggle"
            aria-label={openSections.dashboard ? "Recolher Dashboard" : "Expandir Dashboard"}
            onClick={() => toggleSection("dashboard")}
          >
            {openSections.dashboard ? <FiChevronDown /> : <FiChevronRight />}
          </button>
        </div>
        {openSections.dashboard ? (
          <div className="side-subnav">
            <button type="button" className={`side-sub-item ${navClass("inicio")}`} onClick={(event) => handleSection("inicio", event)}>
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiBarChart2 />
              </span>
              Métricas
            </button>
            <button type="button" className={`side-sub-item ${navClass("gaps")}`} onClick={(event) => handleSection("gaps", event)}>
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiAlertTriangle />
              </span>
              Gaps
            </button>
            <button
              type="button"
              className={`side-sub-item ${navClass("insights")}`}
              onClick={(event) => handleSection("insights", event)}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiZap />
              </span>
              Insights
            </button>
            <button
              type="button"
              className={`side-sub-item ${navClass("relatorio")}`}
              onClick={(event) => handleSection("relatorio", event)}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiFileText />
              </span>
              Relatório
            </button>
          </div>
        ) : null}

        <div className={`side-item-row ${activeView === "analysis" ? "active" : ""}`}>
          <button
            type="button"
            className={sideItemClass(activeView === "analysis")}
            onClick={() => {
              openSection("analysis");
              onOpenAnalysis();
            }}
          >
            <span className="side-item-icon" aria-hidden="true">
              <FiPieChart />
            </span>
            <span>Análise Geral</span>
          </button>
          <button
            type="button"
            className="side-item-toggle"
            aria-label={openSections.analysis ? "Recolher Análise Geral" : "Expandir Análise Geral"}
            onClick={() => toggleSection("analysis")}
          >
            {openSections.analysis ? <FiChevronDown /> : <FiChevronRight />}
          </button>
        </div>
        {openSections.analysis ? (
          <div className="side-subnav">
            <button type="button" className={subItemClass(activeSubNavKey, "analysis-overview")} onClick={() => onNavigateAnalysis("analysis-overview")}>
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiLayers />
              </span>
              Análise do Dia
            </button>
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "analysis-movimentacao")}
              onClick={() => onNavigateAnalysis("analysis-movimentacao")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiBarChart2 />
              </span>
              Movimentação
            </button>
            <button type="button" className={subItemClass(activeSubNavKey, "analysis-conteudo")} onClick={() => onNavigateAnalysis("analysis-conteudo")}>
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiFileText />
              </span>
              Produtos e Contexto
            </button>
          </div>
        ) : null}

        <div className={`side-item-row ${activeView === "attendants" ? "active" : ""}`}>
          <button
            type="button"
            className={sideItemClass(activeView === "attendants")}
            onClick={() => {
              openSection("attendants");
              onOpenAttendants();
            }}
          >
            <span className="side-item-icon" aria-hidden="true">
              <FiActivity />
            </span>
            <span>Atendentes</span>
          </button>
          <button
            type="button"
            className="side-item-toggle"
            aria-label={attendantsOpen ? "Recolher Atendentes" : "Expandir Atendentes"}
            onClick={() => toggleSection("attendants")}
          >
            {attendantsOpen ? <FiChevronDown /> : <FiChevronRight />}
          </button>
        </div>
        {attendantsOpen ? (
          <div className="side-subnav">
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "attendants-overview")}
              onClick={() => onNavigateAttendants("attendants-overview")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiLayers />
              </span>
              Panorama
            </button>
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "attendants-breakdown")}
              onClick={() => onNavigateAttendants("attendants-breakdown")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiUsers />
              </span>
              Por responsável
            </button>
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "attendants-comparison")}
              onClick={() => onNavigateAttendants("attendants-comparison")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiBarChart2 />
              </span>
              Comparativo
            </button>
          </div>
        ) : null}

        <div className={`side-item-row ${activeView === "dissatisfaction" ? "active" : ""}`}>
          <button
            type="button"
            className={sideItemClass(activeView === "dissatisfaction")}
            onClick={() => {
              openSection("dissatisfaction");
              onOpenDissatisfaction();
            }}
          >
            <span className="side-item-icon" aria-hidden="true">
              <FiFrown />
            </span>
            <span>Insatisfação</span>
          </button>
          <button
            type="button"
            className="side-item-toggle"
            aria-label={openSections.dissatisfaction ? "Recolher Insatisfação" : "Expandir Insatisfação"}
            onClick={() => toggleSection("dissatisfaction")}
          >
            {openSections.dissatisfaction ? <FiChevronDown /> : <FiChevronRight />}
          </button>
        </div>
        {openSections.dissatisfaction ? (
          <div className="side-subnav">
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "dissatisfaction-overview")}
              onClick={() => onNavigateDissatisfaction("dissatisfaction-overview")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiLayers />
              </span>
              Panorama
            </button>
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "dissatisfaction-filters")}
              onClick={() => onNavigateDissatisfaction("dissatisfaction-filters")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiBarChart2 />
              </span>
              Filtros
            </button>
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "dissatisfaction-list")}
              onClick={() => onNavigateDissatisfaction("dissatisfaction-list")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiFileText />
              </span>
              Ocorrências
            </button>
          </div>
        ) : null}

        <div className={`side-item-row ${activeView === "clients" ? "active" : ""}`}>
          <button
            type="button"
            className={sideItemClass(activeView === "clients")}
            onClick={() => {
              openSection("clients");
              onOpenClients();
            }}
          >
            <span className="side-item-icon" aria-hidden="true">
              <FiUsers />
            </span>
            <span>Clientes</span>
          </button>
          <button
            type="button"
            className="side-item-toggle"
            aria-label={openSections.clients ? "Recolher Clientes" : "Expandir Clientes"}
            onClick={() => toggleSection("clients")}
          >
            {openSections.clients ? <FiChevronDown /> : <FiChevronRight />}
          </button>
        </div>
        {openSections.clients ? (
          <div className="side-subnav">
            <button type="button" className={subItemClass(activeSubNavKey, "clients-filtros")} onClick={() => onNavigateClients("clients-filtros")}>
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiLayers />
              </span>
              Filtros
            </button>
            <button type="button" className={subItemClass(activeSubNavKey, "clients-kanban")} onClick={() => onNavigateClients("clients-kanban")}>
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiBarChart2 />
              </span>
              Kanban
            </button>
          </div>
        ) : null}

        <div className={`side-item-row ${activeView === "products" ? "active" : ""}`}>
          <button
            type="button"
            className={sideItemClass(activeView === "products")}
            onClick={() => {
              openSection("products");
              onOpenProducts();
            }}
          >
            <span className="side-item-icon" aria-hidden="true">
              <FiBox />
            </span>
            <span>Produtos</span>
          </button>
          <button
            type="button"
            className="side-item-toggle"
            aria-label={openSections.products ? "Recolher Produtos" : "Expandir Produtos"}
            onClick={() => toggleSection("products")}
          >
            {openSections.products ? <FiChevronDown /> : <FiChevronRight />}
          </button>
        </div>
        {openSections.products ? (
          <div className="side-subnav">
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "products-overview")}
              onClick={() => onNavigateProducts("products-overview")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiLayers />
              </span>
              Visão Geral
            </button>
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "products-ranking")}
              onClick={() => onNavigateProducts("products-ranking")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiFileText />
              </span>
              Ranking
            </button>
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "products-charts")}
              onClick={() => onNavigateProducts("products-charts")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiBarChart2 />
              </span>
              Gráficos
            </button>
          </div>
        ) : null}

        <div className={`side-item-row ${activeView === "logs" ? "active" : ""}`}>
          <button
            type="button"
            className={sideItemClass(activeView === "logs")}
            onClick={() => {
              openSection("logs");
              onOpenLogs();
            }}
          >
            <span className="side-item-icon" aria-hidden="true">
              <FiClipboard />
            </span>
            <span>Logs</span>
          </button>
          <button
            type="button"
            className="side-item-toggle"
            aria-label={openSections.logs ? "Recolher Logs" : "Expandir Logs"}
            onClick={() => toggleSection("logs")}
          >
            {openSections.logs ? <FiChevronDown /> : <FiChevronRight />}
          </button>
        </div>
        {openSections.logs ? (
          <div className="side-subnav">
            <button type="button" className={subItemClass(activeSubNavKey, "logs-saude")} onClick={() => onNavigateLogs("logs-saude")}>
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiCheckCircle />
              </span>
              Saúde
            </button>
            <button type="button" className={subItemClass(activeSubNavKey, "logs-execucao")} onClick={() => onNavigateLogs("logs-execucao")}>
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiClock />
              </span>
              Execução
            </button>
            <button type="button" className={subItemClass(activeSubNavKey, "logs-recentes")} onClick={() => onNavigateLogs("logs-recentes")}>
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiFileText />
              </span>
              Histórico
            </button>
          </div>
        ) : null}

        <div className={`side-item-row ${activeView === "settings" ? "active" : ""}`}>
          <button
            type="button"
            className={sideItemClass(activeView === "settings")}
            onClick={() => {
              openSection("settings");
              onOpenSettings();
            }}
          >
            <span className="side-item-icon" aria-hidden="true">
              <FiSettings />
            </span>
            <span>Configurações</span>
          </button>
          <button
            type="button"
            className="side-item-toggle"
            aria-label={openSections.settings ? "Recolher Configurações" : "Expandir Configurações"}
            onClick={() => toggleSection("settings")}
          >
            {openSections.settings ? <FiChevronDown /> : <FiChevronRight />}
          </button>
        </div>
        {openSections.settings ? (
          <div className="side-subnav">
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "settings-profile")}
              onClick={() => onNavigateSettings("settings-profile")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiUsers />
              </span>
              Perfil
            </button>
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "settings-security")}
              onClick={() => onNavigateSettings("settings-security")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiSettings />
              </span>
              Segurança
            </button>
            <button
              type="button"
              className={subItemClass(activeSubNavKey, "settings-preferences")}
              onClick={() => onNavigateSettings("settings-preferences")}
            >
              <span className="side-sub-dot" />
              <span className="side-sub-icon">
                <FiBell />
              </span>
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
  );
}
