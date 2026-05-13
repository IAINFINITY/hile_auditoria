import { NextResponse } from "next/server";
import { getAppConfig } from "@/lib/server/apiUtils";
import { discoverChatwootTarget } from "@/lib/server/audit/auditService";

export const runtime = "nodejs";

export async function GET() {
  try {
    const config = getAppConfig();
    const output = await discoverChatwootTarget({ config });
    return NextResponse.json(output);
  } catch (error: any) {
    return NextResponse.json(
      { error: "target_discovery_failed", message: error?.message || "Falha ao descobrir target do Chatwoot." },
      { status: 400 },
    );
  }
}
