import { NextResponse } from "next/server";
import { getRunSnapshot } from "@/lib/server/audit/auditPersistence";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const runId = String(searchParams.get("run_id") || "").trim();
    if (!runId) {
      return NextResponse.json(
        { error: "invalid_param", message: "Parâmetro run_id é obrigatório." },
        { status: 400 },
      );
    }

    const snapshot = await getRunSnapshot(runId);
    if (!snapshot) {
      return NextResponse.json(
        { error: "run_not_found", message: "Execução não encontrada." },
        { status: 404 },
      );
    }

    return NextResponse.json(snapshot);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar a execução.";
    return NextResponse.json({ error: "report_run_failed", message }, { status: 400 });
  }
}

