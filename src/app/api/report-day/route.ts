import { NextResponse } from "next/server";
import { buildDailyReport } from "@/lib/server/audit/auditService";
import { getAppConfig, parseDateInput, readJsonBody } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const allowUnsafeDirectMode = process.env.ALLOW_UNSAFE_DIRECT_ANALYSIS === "true";
    if (!allowUnsafeDirectMode) {
      return NextResponse.json(
        {
          error: "direct_report_disabled",
          message:
            "Geração direta desativada para evitar duplicidade de execução. Use /api/report-day/start.",
        },
        { status: 409 },
      );
    }

    const config = getAppConfig();
    const body = await readJsonBody<{ date?: string }>(request);
    const date = parseDateInput(body?.date, config.timezone);
    const output = await buildDailyReport({ config, date });
    return NextResponse.json(output);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha no relatório.";
    return NextResponse.json({ error: "report_failed", message }, { status: 400 });
  }
}
