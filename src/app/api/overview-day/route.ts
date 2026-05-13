import { NextResponse } from "next/server";
import { buildDailyOverview } from "@/lib/server/audit/auditService";
import { getAppConfig, parseDateInput, readJsonBody } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const config = getAppConfig();
    const body = await readJsonBody<{ date?: string }>(request);
    const date = parseDateInput(body?.date, config.timezone);
    const output = await buildDailyOverview({ config, date });
    return NextResponse.json(output);
  } catch (error: any) {
    return NextResponse.json({ error: "overview_failed", message: error?.message || "Falha no overview." }, { status: 400 });
  }
}
