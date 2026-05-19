import type { ClientPhase } from "../../../../../types";

export type AccountStatus = "entrada" | "remarketing" | "atencao" | "resolvido";
export type ResponsibleFilter = "all" | "ia" | "suellen" | "samuel";
export type ClientsScope = "day" | "overall";

export interface AccountsViewProps {
  selectedDate: string;
  knownRunId?: string | null;
  refreshHint?: string | null;
}

export const STATUS_ORDER: AccountStatus[] = ["entrada", "remarketing", "atencao", "resolvido"];

export type PhaseFilter = "all" | ClientPhase;

