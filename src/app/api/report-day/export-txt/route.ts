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
  lines.push("RELAT\u00d3RIO DE AUDITORIA");
  lines.push(`Data de refer\u00eancia: ${run.date_ref}`);
  lines.push(`Execu\u00e7\u00e3o: ${run.id}`);
  lines.push(`Status: ${run.status}`);
  lines.push(`In\u00edcio: ${run.started_at}`);
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

  lines.push("Relat\u00f3rio em markdown n\u00e3o encontrado. Conte\u00fado JSON abaixo:");
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
  lines.push("RELAT\u00d3RIO CONSOLIDADO");
  lines.push(`Escopo: ${label}`);
  lines.push(`Execu\u00e7\u00f5es: ${runs.length}`);
  lines.push("");
  lines.push("=".repeat(72));
  lines.push("");

  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    lines.push(`# EXECU\u00c7\u00c3O ${index + 1}`);
    lines.push(`Data de refer\u00eancia: ${run.dateRef.toISOString().slice(0, 10)}`);
    lines.push(`Execu\u00e7\u00e3o: ${run.id}`);
    lines.push(`Status: ${run.status}`);
    lines.push(`In\u00edcio: ${run.startedAt.toISOString()}`);
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
      lines.push("Relat\u00f3rio em markdown n\u00e3o encontrado. Conte\u00fado JSON abaixo:");
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
          { error: "run_not_found", message: "Execu\u00e7\u00e3o n\u00e3o encontrada ou sem relat\u00f3rio salvo." },
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
          { error: "invalid_param", message: "Par\u00e2metro preset inv\u00e1lido para exporta\u00e7\u00e3o de per\u00edodo." },
          { status: 400 },
        );
      }
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json(
          { error: "invalid_param", message: "Par\u00e2metro date em YYYY-MM-DD \u00e9 obrigat\u00f3rio para exporta\u00e7\u00e3o de per\u00edodo." },
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
          { error: "run_not_found", message: "Sem relat\u00f3rios salvos para o per\u00edodo selecionado." },
          { status: 404 },
        );
      }

      const label = range ? `${preset} (${range.from} a ${range.to})` : "total (todas as execu\u00e7\u00f5es)";
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
        { error: "invalid_param", message: "Par\u00e2metro date \u00e9 obrigat\u00f3rio." },
        { status: 400 },
      );
    }

    const run = await getLatestRunByDate(date);
    if (!run) {
      return NextResponse.json(
        { error: "run_not_found", message: "Sem relat\u00f3rio salvo para a data selecionada." },
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
    const message = error instanceof Error ? error.message : "N\u00e3o foi poss\u00edvel exportar o relat\u00f3rio.";
    return NextResponse.json({ error: "report_export_failed", message }, { status: 400 });
  }
}
