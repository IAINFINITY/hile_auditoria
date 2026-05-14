import { NextResponse } from "next/server";
import { getAppConfig, requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import { discoverChatwootTarget } from "@/lib/server/audit/auditService";

export const runtime = "nodejs";

export async function GET() {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const config = getAppConfig();
    const output = await discoverChatwootTarget({ config });
    return NextResponse.json(output);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao descobrir target do Chatwoot.";
    return NextResponse.json({ error: "target_discovery_failed", message }, { status: 400 });
  }
}

