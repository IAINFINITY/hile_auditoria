import { NextResponse } from "next/server";
import {
  getAuthorizedUserContext,
  hasRequiredRole,
  registerAuthAuditEvent,
  type AppAuthRole,
} from "@/lib/auth/server";
import { assertRequiredConfig, getConfig } from "@/lib/server/audit/config";
import { assertYmd, todayYmd } from "@/lib/server/audit/dateUtils";
import { createRouteHandlerSupabaseClient } from "@/lib/supabase/server";

let cachedConfig: ReturnType<typeof getConfig> | null = null;

export function getAppConfig() {
  if (!cachedConfig) {
    cachedConfig = getConfig();
    assertRequiredConfig(cachedConfig);
  }
  return cachedConfig;
}

export function parseDateInput(inputDate: string | undefined | null, timezone: string): string {
  const date = inputDate || todayYmd(timezone);
  assertYmd(date);
  return date;
}

export async function readJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    return (body || {}) as T;
  } catch {
    throw new Error("Body JSON invalido.");
  }
}

export function isUnsafeDirectAnalysisAllowed(): boolean {
  const enabled = process.env.ALLOW_UNSAFE_DIRECT_ANALYSIS === "true";
  const isProduction = process.env.NODE_ENV === "production";
  return enabled && !isProduction;
}

export interface AuthorizedApiUser {
  id: string;
  email: string;
  role: AppAuthRole;
  allowedUserId: string | null;
}

export async function getAuthorizedApiUser() {
  const supabase = await createRouteHandlerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    return {
      response: NextResponse.json(
        { error: "unauthorized", message: "Faca login para acessar esta rota." },
        { status: 401 },
      ),
      user: null as AuthorizedApiUser | null,
    };
  }

  const access = await getAuthorizedUserContext(supabase, { id: user.id, email: user.email || null });
  if (!access.authorized || !access.role) {
    await registerAuthAuditEvent({
      actorUserId: user.id,
      actorEmail: user.email || null,
      actorRole: null,
      eventType: "auth_access_denied",
      outcome: "denied",
      reason: access.reason || "not_authorized",
    });
    return {
      response: NextResponse.json(
        { error: "forbidden", message: "Este usuario nao possui permissao para o painel." },
        { status: 403 },
      ),
      user: null as AuthorizedApiUser | null,
    };
  }

  return {
    response: null as NextResponse | null,
    user: {
      id: user.id,
      email: user.email,
      role: access.role,
      allowedUserId: access.allowedUserId,
    } satisfies AuthorizedApiUser,
  };
}

export async function requireAuthorizedApiAccess() {
  const { response } = await getAuthorizedApiUser();
  return response;
}

export async function requireRole(requiredRole: AppAuthRole) {
  const auth = await getAuthorizedApiUser();
  if (auth.response) return auth;
  if (!hasRequiredRole(auth.user?.role, requiredRole)) {
    return {
      response: NextResponse.json(
        { error: "forbidden", message: "Permissao insuficiente para esta operacao." },
        { status: 403 },
      ),
      user: auth.user,
    };
  }
  return auth;
}
