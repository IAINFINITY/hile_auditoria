import type { ShellView } from "./types";

export function sideItemClass(isActive: boolean): string {
  return `side-item ${isActive ? "active" : ""}`;
}

export function subItemClass(activeSubNavKey: string, key: string): string {
  return `side-sub-item ${activeSubNavKey === key ? "active" : ""}`;
}

export function formatNotifyTime(isoText: string | null | undefined): string | null {
  if (!isoText) return null;
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
}

export function resolveCurrentBreadcrumb(
  activeView: ShellView,
  navClass: (section: string) => string,
): string {
  const sectionLabels: Record<string, string> = {
    inicio: "Métricas do Dia",
    gaps: "Gaps Identificados",
    insights: "Insights de Melhoria",
  };
  const activeSection = Object.keys(sectionLabels).find((key) => navClass(key) === "active") || "inicio";

  if (activeView === "dashboard") return sectionLabels[activeSection];
  if (activeView === "clients") return "Clientes";
  if (activeView === "analysis") return "Análise Geral do Dia";
  if (activeView === "attendants") return "Desempenho de Atendentes";
  if (activeView === "dissatisfaction") return "Insatisfação";
  if (activeView === "products") return "Produtos (Geral)";
  if (activeView === "logs") return "Logs Operacionais";
  if (activeView === "superadmin") return "Superadmin";
  return "Configurações";
}

