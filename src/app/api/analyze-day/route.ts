import { NextResponse } from "next/server";
import { runDailyAnalysis } from "@/lib/server/audit/auditService";
import {
  getAppConfig,
  isUnsafeDirectAnalysisAllowed,
  parseDateInput,
  readJsonBody,
  requireAuthorizedApiAccess,
} from "@/lib/server/apiUtils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    if (!isUnsafeDirectAnalysisAllowed()) {
      return NextResponse.json(
        {
          error: "direct_analysis_disabled",
          message:
            "Execução direta desativada para evitar duplicidade de análises e consumo extra. Use /api/report-day/start.",
        },
        { status: 403 },
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

