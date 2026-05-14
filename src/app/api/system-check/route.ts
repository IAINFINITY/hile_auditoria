import { NextResponse } from "next/server";
import { getAppConfig, requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import { discoverChatwootTarget } from "@/lib/server/audit/auditService";
import { createDifyClient } from "@/lib/server/audit/difyClient";

export const runtime = "nodejs";

type CheckResult = {
  ok: boolean;
  checked_at: string;
  chatwoot: { ok: boolean; message: string | null; target?: unknown };
  dify: { ok: boolean; message?: string; status?: number | null; code?: string | null };
  elapsed_ms: number;
};

export async function GET() {
  const authResponse = await requireAuthorizedApiAccess();
  if (authResponse) return authResponse;

  const started = Date.now();
  const config = getAppConfig();
  const result: CheckResult = {
    ok: true,
    checked_at: new Date().toISOString(),
    chatwoot: { ok: false, message: null },
    dify: { ok: false },
    elapsed_ms: 0,
  };

  try {
    const target = await discoverChatwootTarget({ config });
    result.chatwoot = { ok: true, message: null, target };
  } catch (error: unknown) {
    result.ok = false;
    result.chatwoot = {
      ok: false,
      message: error instanceof Error ? error.message : "Falha no Chatwoot",
    };
  }

  try {
    const difyClient = createDifyClient(config.dify);
    const health = await difyClient.testConnection();
    if (!health.ok) result.ok = false;
    result.dify = health;
  } catch (error: unknown) {
    result.ok = false;
    result.dify = {
      ok: false,
      message: error instanceof Error ? error.message : "Falha no Dify",
    };
  }

  result.elapsed_ms = Date.now() - started;
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}

