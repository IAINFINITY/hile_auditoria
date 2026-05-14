import { NextResponse } from "next/server";
import { listAvailableReportDates } from "@/lib/server/audit/auditPersistence";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 365);
    const dates = await listAvailableReportDates(limit);
    return NextResponse.json({ dates, count: dates.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Não foi possível listar datas disponíveis.";
    return NextResponse.json({ error: "available_dates_failed", message }, { status: 400 });
  }
}
