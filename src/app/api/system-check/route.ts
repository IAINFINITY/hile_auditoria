import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/server/apiUtils";
import { discoverChatwootTarget } from "@/lib/server/audit/auditService";
import { createDifyClient } from "@/lib/server/audit/difyClient";

export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();
  const config = getAppConfig();
  const result: any = {
    ok: true,
    checked_at: new Date().toISOString(),
    chatwoot: { ok: false, message: null },
    dify: { ok: false, message: null },
    elapsed_ms: 0,
  };

  try {
    const target = await discoverChatwootTarget({ config });
    result.chatwoot = { ok: true, target };
  } catch (error: any) {
    result.ok = false;
    result.chatwoot = { ok: false, message: error?.message || "Falha no Chatwoot" };
  }

  try {
    const difyClient = createDifyClient(config.dify);
    const health = await difyClient.testConnection();
    if (!health.ok) result.ok = false;
    result.dify = health;
  } catch (error: any) {
    result.ok = false;
    result.dify = { ok: false, message: error?.message || "Falha no Dify" };
  }

  result.elapsed_ms = Date.now() - started;
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
