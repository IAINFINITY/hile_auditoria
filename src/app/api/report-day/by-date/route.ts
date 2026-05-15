import { NextResponse } from "next/server";
import { getLatestRunByDate } from "@/lib/server/audit/auditPersistence";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const date = String(searchParams.get("date") || "").trim();
    if (!date) {
      return NextResponse.json(
        { error: "invalid_param", message: "Parâmetro date é obrigatório." },
        { status: 400 },
      );
    }

    const run = await getLatestRunByDate(date);
    if (!run) {
      return NextResponse.json(
        { error: "run_not_found", message: "Sem relatório salvo para a data selecionada." },
        { status: 404 },
      );
    }

    return NextResponse.json({ run });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Não foi possível buscar relatório por data.";
    return NextResponse.json({ error: "report_by_date_failed", message }, { status: 400 });
  }
}
