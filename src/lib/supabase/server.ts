import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

type SupabaseAuthUser = {
  id?: string | null;
  email?: string | null;
};

type SupabaseSession = {
  access_token?: string | null;
};

function extractErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const directCode = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  if (directCode) return directCode;
  const cause = "cause" in error ? (error as { cause?: unknown }).cause : null;
  if (cause && typeof cause === "object" && "code" in cause) {
    return String((cause as { code?: unknown }).code || "");
  }
  return "";
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || "";
  return String(error || "");
}

export function isTransientAuthNetworkError(error: unknown): boolean {
  const code = extractErrorCode(error).toUpperCase();
  if (["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
    return true;
  }

  const message = extractErrorMessage(error).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("timed out") ||
    message.includes("network")
  );
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  if (typeof atob === "function") {
    return atob(padded);
  }
  throw new Error("Base64 decoder unavailable.");
}

function readUserFromAccessToken(accessToken: string): SupabaseAuthUser | null {
  try {
    const parts = String(accessToken || "").split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { sub?: unknown; email?: unknown; user_id?: unknown };
    const id = String(payload.sub || payload.user_id || "").trim();
    const email = String(payload.email || "").trim().toLowerCase();
    if (!id || !email) return null;
    return { id, email };
  } catch {
    return null;
  }
}

async function getUserWithRetry(
  getter: () => Promise<{ data: { user: SupabaseAuthUser | null }; error: unknown }>,
  attempts = 2,
): Promise<{ data: { user: SupabaseAuthUser | null }; error: unknown }> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await getter();
      if (!result.error || !isTransientAuthNetworkError(result.error) || attempt === attempts) {
        return result;
      }
      lastError = result.error;
    } catch (error) {
      if (!isTransientAuthNetworkError(error) || attempt === attempts) {
        throw error;
      }
      lastError = error;
    }
  }

  return { data: { user: null }, error: lastError };
}

function getSupabaseEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return { supabaseUrl, supabaseAnonKey };
}

export function createRouteHandlerSupabaseClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
  return cookies().then((cookieStore) =>
    createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    }),
  );
}

export function createProxySupabaseClient(request: NextRequest, responseRef: { current: NextResponse }) {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) => responseRef.current.cookies.set(name, value, options));
      },
    },
  });
}

export function createServiceRoleSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function readRequestAuthUser(
  supabase: {
    auth: {
      getSession: () => Promise<{ data: { session: SupabaseSession | null }; error: unknown }>;
      getUser: () => Promise<{ data: { user: SupabaseAuthUser | null }; error: unknown }>;
    };
  },
) {
  let accessToken = "";
  try {
    const sessionResult = await supabase.auth.getSession();
    accessToken = String(sessionResult.data.session?.access_token || "").trim();
    if (!accessToken) {
      return { user: null, error: null, source: "session" as const };
    }
  } catch {
    // Fall back to remote user validation below.
  }

  try {
    const userResult = await getUserWithRetry(() => supabase.auth.getUser(), 2);
    if (!userResult.error && userResult.data.user) {
      return {
        user: userResult.data.user,
        error: null,
        source: "user" as const,
      };
    }

    if (process.env.NODE_ENV !== "production" && accessToken && isTransientAuthNetworkError(userResult.error)) {
      const fallbackUser = readUserFromAccessToken(accessToken);
      if (fallbackUser?.id && fallbackUser?.email) {
        return {
          user: fallbackUser,
          error: null,
          source: "token_fallback_dev" as const,
        };
      }
    }

    return {
      user: userResult.data.user ?? null,
      error: userResult.error,
      source: "user" as const,
    };
  } catch (error) {
    return {
      user: null,
      error,
      source: "user" as const,
    };
  }
}
