import { NextResponse } from "next/server";
import { buildDailyOverview } from "@/lib/server/audit/auditService";
import { getAppConfig, parseDateInput, readJsonBody, requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const config = getAppConfig();
    const body = await readJsonBody<{ date?: string }>(request);
    const date = parseDateInput(body?.date, config.timezone);
    const output = await buildDailyOverview({ config, date });
    return NextResponse.json(output);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha no overview.";
    return NextResponse.json({ error: "overview_failed", message }, { status: 400 });
  }
}

