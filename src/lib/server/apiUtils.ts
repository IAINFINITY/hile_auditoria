import { NextResponse } from "next/server";
import { getIsAuthorizedUser } from "@/lib/auth/server";
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
    throw new Error("Body JSON inválido.");
  }
}

export function isUnsafeDirectAnalysisAllowed(): boolean {
  const enabled = process.env.ALLOW_UNSAFE_DIRECT_ANALYSIS === "true";
  const isProduction = process.env.NODE_ENV === "production";
  return enabled && !isProduction;
}

export async function requireAuthorizedApiAccess() {
  const supabase = await createRouteHandlerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json(
      { error: "unauthorized", message: "Faça login para acessar esta rota." },
      { status: 401 },
    );
  }

  const authorized = await getIsAuthorizedUser(supabase, user.id);
  if (!authorized) {
    return NextResponse.json(
      { error: "forbidden", message: "Este usuário não possui permissão para o painel." },
      { status: 403 },
    );
  }

  return null;
}

