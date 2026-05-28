import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLatestRunByDate } from "@/lib/server/audit/auditPersistence";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

type ExportPreset = "week" | "month" | "year" | "total";

function toDateRef(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateRange(date: string, preset: ExportPreset): { from: string; to: string } | null {
  if (preset === "total") return null;
  const anchor = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(anchor.getTime())) return null;
  const from = new Date(anchor);
  if (preset === "week") from.setDate(anchor.getDate() - 6);
  if (preset === "month") from.setDate(anchor.getDate() - 29);
  if (preset === "year") from.setDate(anchor.getDate() - 364);
  const toYmd = (d: Date) => d.toISOString().slice(0, 10);
  return { from: toYmd(from), to: toYmd(anchor) };
}

function buildTxtFromRun(run: NonNullable<Awaited<ReturnType<typeof getLatestRunByDate>>>): string {
  const lines: string[] = [];
  lines.push("RELATÓRIO DE AUDITORIA");
  lines.push(`Data de referência: ${run.date_ref}`);
  lines.push(`Execução: ${run.id}`);
  lines.push(`Status: ${run.status}`);
  lines.push(`Início: ${run.started_at}`);
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

  lines.push("Relatório em markdown não encontrado. Conteúdo JSON abaixo:");
  lines.push("");
  lines.push(JSON.stringify(run.report_json || {}, null, 2));
  return lines.join("\n");
}

function buildTxtFromRuns(
  runs: Array<{
    id: string;
    status: string;
    dateRef: Date;
    startedAt: Date;
    finishedAt: Date | null;
    totalConversations: number;
    processed: number;
    successCount: number;
    failureCount: number;
    tenant: { name: string | null } | null;
    channel: { name: string | null } | null;
    report: { reportMarkdown: string | null; reportJson: unknown | null } | null;
  }>,
  label: string,
): string {
  const lines: string[] = [];
  lines.push("RELATÓRIO CONSOLIDADO");
  lines.push(`Escopo: ${label}`);
  lines.push(`Execucoes: ${runs.length}`);
  lines.push("");
  lines.push("=".repeat(72));
  lines.push("");

  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    lines.push(`# EXECUÇÃO ${index + 1}`);
    lines.push(`Data de referência: ${run.dateRef.toISOString().slice(0, 10)}`);
    lines.push(`Execução: ${run.id}`);
    lines.push(`Status: ${run.status}`);
    lines.push(`Início: ${run.startedAt.toISOString()}`);
    lines.push(`Fim: ${run.finishedAt ? run.finishedAt.toISOString() : "-"}`);
    lines.push(`Processadas: ${run.processed}/${run.totalConversations}`);
    lines.push(`Sucesso: ${run.successCount} | Falhas: ${run.failureCount}`);
    lines.push(`Tenant: ${run.tenant?.name || "-"}`);
    lines.push(`Canal: ${run.channel?.name || "-"}`);
    lines.push("");
    const markdown = String(run.report?.reportMarkdown || "").trim();
    if (markdown) {
      lines.push(markdown);
    } else {
      lines.push("Relatório em markdown não encontrado. Conteúdo JSON abaixo:");
      lines.push(JSON.stringify(run.report?.reportJson || {}, null, 2));
    }
    lines.push("");
    lines.push("-".repeat(72));
    lines.push("");
  }

  return lines.join("\n");
}

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const scope = String(searchParams.get("scope") || "day").trim().toLowerCase();
    const runId = String(searchParams.get("run_id") || "").trim();
    const date = String(searchParams.get("date") || "").trim();

    if (runId) {
      const run = await prisma.analysisRun.findUnique({
        where: { id: runId },
        include: {
          tenant: { select: { name: true } },
          channel: { select: { name: true } },
          report: {
            select: {
              reportMarkdown: true,
              reportJson: true,
            },
          },
        },
      });

      if (!run || run.status !== RunStatus.completed || !run.report) {
        return NextResponse.json(
          { error: "run_not_found", message: "Execução não encontrada ou sem relatório salvo." },
          { status: 404 },
        );
      }

      const body = buildTxtFromRuns(
        [
          {
            id: run.id,
            status: run.status,
            dateRef: run.dateRef,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            totalConversations: run.totalConversations,
            processed: run.processed,
            successCount: run.successCount,
            failureCount: run.failureCount,
            tenant: run.tenant,
            channel: run.channel,
            report: {
              reportMarkdown: run.report.reportMarkdown,
              reportJson: run.report.reportJson,
            },
          },
        ],
        `run (${run.id})`,
      );

      const fileName = `relatorio-${run.dateRef.toISOString().slice(0, 10)}-${run.id.slice(0, 8)}.txt`;
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (scope === "period") {
      const preset = String(searchParams.get("preset") || "").trim().toLowerCase() as ExportPreset;
      if (!["week", "month", "year", "total"].includes(preset)) {
        return NextResponse.json(
          { error: "invalid_param", message: "Parâmetro preset inválido para exportação de período." },
          { status: 400 },
        );
      }
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json(
          { error: "invalid_param", message: "Parâmetro date em YYYY-MM-DD é obrigatório para exportação de período." },
          { status: 400 },
        );
      }

      const range = toDateRange(date, preset);
      const runs = await prisma.analysisRun.findMany({
        where: {
          status: RunStatus.completed,
          report: { isNot: null },
          ...(range
            ? {
                dateRef: {
                  gte: toDateRef(range.from),
                  lte: new Date(`${range.to}T23:59:59.999Z`),
                },
              }
            : {}),
        },
        orderBy: [{ dateRef: "desc" }, { startedAt: "desc" }],
        take: 1000,
        include: {
          tenant: { select: { name: true } },
          channel: { select: { name: true } },
          report: {
            select: {
              reportMarkdown: true,
              reportJson: true,
            },
          },
        },
      });

      if (runs.length === 0) {
        return NextResponse.json(
          { error: "run_not_found", message: "Sem relatórios salvos para o período selecionado." },
          { status: 404 },
        );
      }

      const label = range ? `${preset} (${range.from} a ${range.to})` : "total (todas as execuções)";
      const body = buildTxtFromRuns(runs, label);
      const fileName = range
        ? `relatorio-${preset}-${range.from}-ate-${range.to}.txt`
        : "relatorio-total.txt";

      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }

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
    const message = error instanceof Error ? error.message : "Não foi possível exportar o relatório.";
    return NextResponse.json({ error: "report_export_failed", message }, { status: 400 });
  }
}
