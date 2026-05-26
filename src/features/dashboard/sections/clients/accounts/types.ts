import type { ClientPhase } from "../../../../../types";
import type { OwnerScope } from "@/features/dashboard/shared/types";

export type AccountStatus = "entrada" | "remarketing" | "atencao" | "resolvido";
export type ResponsibleFilter = "all" | "ia" | "suellen" | "samuel";
export type ClientsScope = "day" | "overall";

export interface AccountsViewProps {
  selectedDate: string;
  knownRunId?: string | null;
  refreshHint?: string | null;
  ownerScope: OwnerScope;
  onSetOwnerScope: (scope: OwnerScope) => void;
}

export const STATUS_ORDER: AccountStatus[] = ["entrada", "remarketing", "atencao", "resolvido"];

export type PhaseFilter = "all" | ClientPhase;

