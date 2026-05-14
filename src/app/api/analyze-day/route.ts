import { NextResponse } from "next/server";
import { runDailyAnalysis } from "@/lib/server/audit/auditService";
import { getAppConfig, parseDateInput, readJsonBody } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const allowUnsafeDirectMode = process.env.ALLOW_UNSAFE_DIRECT_ANALYSIS === "true";
    if (!allowUnsafeDirectMode) {
      return NextResponse.json(
        {
          error: "direct_analysis_disabled",
          message:
            "Execução direta desativada para evitar duplicidade de análises e consumo extra. Use /api/report-day/start.",
        },
        { status: 409 },
      );
    }

    const config = getAppConfig();
    const body = await readJsonBody<{ date?: string }>(request);
    const date = parseDateInput(body?.date, config.timezone);
    const output = await runDailyAnalysis({ config, date });
    return NextResponse.json(output);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha na análise.";
    return NextResponse.json({ error: "analysis_failed", message }, { status: 400 });
  }
}
