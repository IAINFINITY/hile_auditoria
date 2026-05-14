import { NextResponse } from "next/server";
import { listRecentRuns } from "@/lib/server/audit/auditPersistence";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 10);
    const items = await listRecentRuns(limit);
    return NextResponse.json({ items, count: items.length });
  } catch (error: any) {
    return NextResponse.json(
      { error: "report_history_failed", message: error?.message || "Não foi possível carregar o histórico." },
      { status: 400 },
    );
  }
}
