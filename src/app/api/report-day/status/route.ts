import { NextResponse } from "next/server";
import { getRunSnapshot } from "@/lib/server/audit/auditPersistence";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import { cleanupReportJobs, getReportJobsStore } from "@/lib/server/reportJobs";
import type { ReportPayload } from "@/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    cleanupReportJobs();

    const { searchParams } = new URL(request.url);
    const jobId = String(searchParams.get("job_id") || "").trim();
    const runId = String(searchParams.get("run_id") || "").trim();

    if (!jobId && !runId) {
      return NextResponse.json(
        { error: "invalid_param", message: "Informe job_id ou run_id." },
        { status: 400 },
      );
    }

    if (jobId) {
      const jobs = getReportJobsStore();
      const state = jobs.get(jobId);
      if (state) return NextResponse.json(state);
    }

    if (!runId) {
      return NextResponse.json(
        { error: "job_not_found", message: "Job não encontrado ou expirado." },
        { status: 404 },
      );
    }

    const snapshot = await getRunSnapshot(runId);
    if (!snapshot) {
      return NextResponse.json(
        { error: "run_not_found", message: "Execução não encontrada." },
        { status: 404 },
      );
    }

    const runStatus = snapshot.run.status;
    const status = runStatus === "running" ? "running" : runStatus === "failed" ? "failed" : "completed";

    return NextResponse.json({
      job_id: jobId || `db:${runId}`,
      db_run_id: runId,
      date: snapshot.run.date_ref,
      status,
      started_at: snapshot.run.started_at,
      updated_at: snapshot.run.finished_at || snapshot.run.started_at,
      total: snapshot.run.total_conversations || 0,
      processed: snapshot.run.processed || 0,
      current_contact: null,
      execution_order: [],
      result:
        status === "completed" && snapshot.report_json
          ? (snapshot.report_json as unknown as ReportPayload)
          : null,
      error: status === "failed" ? "Execução finalizada com falha." : null,
      restored_from_db: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Não foi possível consultar o status do relatório.";
    return NextResponse.json({ error: "report_status_failed", message }, { status: 400 });
  }
}
