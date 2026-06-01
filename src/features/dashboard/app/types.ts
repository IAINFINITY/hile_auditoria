export type AppView =
  | "dashboard"
  | "clients"
  | "analysis"
  | "attendants"
  | "dissatisfaction"
  | "products"
  | "logs"
  | "superadmin"
  | "settings";

export interface AuthStatusPayload {
  authenticated: boolean;
  authorized: boolean;
  user: {
    id: string;
    email: string | null;
    role: "superadmin" | "admin" | null;
  } | null;
}
