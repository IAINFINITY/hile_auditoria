import { NextResponse } from "next/server";
import { listRecentRuns } from "@/lib/server/audit/auditPersistence";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 10);
    const items = await listRecentRuns(limit);
    return NextResponse.json({ items, count: items.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar o histórico.";
    return NextResponse.json({ error: "report_history_failed", message }, { status: 400 });
  }
}

