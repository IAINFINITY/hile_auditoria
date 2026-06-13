import { NextResponse } from "next/server";
import { getLatestRunByDate, listRunsByDate } from "@/lib/server/audit/auditPersistence";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import { aggregateSnapshots } from "@/features/dashboard/hooks/controller/periodAggregation";
import { mapRunToDashboardSnapshot } from "@/features/dashboard/hooks/controller/runSnapshotMapper";
import type { ReportByDateResponse } from "@/types";

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

    const aggregateMode = ["1", "true", "yes"].includes(String(searchParams.get("aggregate") || "").trim().toLowerCase());
    if (aggregateMode) {
      const runs = await listRunsByDate(date);
      if (!runs.length) {
        return NextResponse.json(
          { error: "run_not_found", message: "Sem relatório salvo para a data selecionada." },
          { status: 404 },
        );
      }

      const snapshots = runs.map((run) => mapRunToDashboardSnapshot(run as ReportByDateResponse["run"]));
      const aggregated = aggregateSnapshots(snapshots, date);
      const latest = runs[runs.length - 1];

      return NextResponse.json({
        run: {
          id: latest.id,
          status: latest.status,
          date_ref: date,
          report_date: date,
          trigger_source: latest.trigger_source,
          requested_date: latest.requested_date,
          requested_at: latest.requested_at,
          requested_by_user_id: latest.requested_by_user_id || null,
          requested_by_allowed_user_id: latest.requested_by_allowed_user_id || null,
          requested_by_email: latest.requested_by_email || null,
          requested_by_name: latest.requested_by_name || null,
          requested_by_role: latest.requested_by_role || null,
          started_at: latest.started_at,
          finished_at: latest.finished_at,
          total_conversations: aggregated.overview.overview.conversations_scanned,
          processed: aggregated.report.summary.processed,
          success_count: aggregated.report.summary.processed,
          failure_count: aggregated.report.summary.failures_count,
          tenant: latest.tenant,
          channel: latest.channel,
          has_report: true,
          report_json: aggregated.report,
          report_markdown: aggregated.rawOutput,
        },
      });
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
