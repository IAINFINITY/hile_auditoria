import type { AppView } from "./types";

export const VIEW_SECTION_KEYS: Record<Exclude<AppView, "dashboard">, string[]> = {
  clients: ["clients-filtros", "clients-kanban"],
  analysis: ["analysis-overview", "analysis-movimentacao", "analysis-conteudo"],
  attendants: ["attendants-overview", "attendants-breakdown", "attendants-comparison"],
  dissatisfaction: ["dissatisfaction-overview", "dissatisfaction-filters", "dissatisfaction-list"],
  products: ["products-overview", "products-ranking", "products-charts"],
  logs: ["logs-saude", "logs-execucao", "logs-recentes"],
  superadmin: ["superadmin-accounts"],
  settings: ["settings-profile", "settings-security", "settings-preferences"],
};
