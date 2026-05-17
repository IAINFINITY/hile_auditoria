import { NextResponse } from "next/server";
import { getLatestRunByDate } from "@/lib/server/audit/auditPersistence";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

function buildTxtFromRun(run: NonNullable<Awaited<ReturnType<typeof getLatestRunByDate>>>): string {
  const lines: string[] = [];
  lines.push("RELATORIO DE AUDITORIA");
  lines.push(`Data de referencia: ${run.date_ref}`);
  lines.push(`Execucao: ${run.id}`);
  lines.push(`Status: ${run.status}`);
  lines.push(`Inicio: ${run.started_at}`);
  lines.push(`Fim: ${run.finished_at || "-"}`);
  lines.push(`Processadas: ${run.processed}/${run.total_conversations}`);
  lines.push(`Sucesso: ${run.success_count} | Falhas: ${run.failure_count}`);
  lines.push(`Tenant: ${run.tenant}`);
  lines.push(`Canal: ${run.channel}`);
  lines.push("");
  lines.push("=".repeat(72));
  lines.push("");

  const markdown = String(run.report_markdown || "").trim();
  if (markdown) {
    lines.push(markdown);
    return lines.join("\n");
  }

  lines.push("Relatorio em markdown nao encontrado. Conteudo JSON abaixo:");
  lines.push("");
  lines.push(JSON.stringify(run.report_json || {}, null, 2));
  return lines.join("\n");
}

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const date = String(searchParams.get("date") || "").trim();
    if (!date) {
      return NextResponse.json(
        { error: "invalid_param", message: "Parametro date e obrigatorio." },
        { status: 400 },
      );
    }

    const run = await getLatestRunByDate(date);
    if (!run) {
      return NextResponse.json(
        { error: "run_not_found", message: "Sem relatorio salvo para a data selecionada." },
        { status: 404 },
      );
    }

    const body = buildTxtFromRun(run);
    const fileName = `relatorio-${run.date_ref}.txt`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Nao foi possivel exportar o relatorio.";
    return NextResponse.json({ error: "report_export_failed", message }, { status: 400 });
  }
}

