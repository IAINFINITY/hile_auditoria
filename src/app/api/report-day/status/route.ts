import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  getCurrentContactFromRunEvents,
  getCurrentWaitStateFromRunEvents,
  getRunSnapshot,
  markRunFailed,
} from "@/lib/server/audit/auditPersistence";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import { cleanupReportJobs, getReportJobsStore } from "@/lib/server/reportJobs";
import type { ReportPayload } from "@/types";

export const runtime = "nodejs";

function toStaleMinutes(): number {
  const raw = Number(process.env.REPORT_JOB_RUNNING_STALE_MINUTES || process.env.ANALYSIS_RUNNING_STALE_MINUTES || 30);
  if (!Number.isFinite(raw)) return 30;
  return Math.min(240, Math.max(5, Math.floor(raw)));
}

function resolveJobPhase(params: {
  status: "running" | "completed" | "failed";
  processed: number;
  total: number;
  currentContact: unknown;
  phase?: string | null;
}): "processing" | "waiting" | "finalizing" | "completed" | "failed" {
  if (
    params.phase === "processing" ||
    params.phase === "waiting" ||
    params.phase === "finalizing" ||
    params.phase === "completed" ||
    params.phase === "failed"
  ) {
    return params.phase;
  }
  if (params.status === "failed") return "failed";
  if (params.status === "completed") return "completed";
  if (params.total > 0 && params.processed >= params.total && !params.currentContact) return "finalizing";
  return "processing";
}

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
      if (state) {
        if (state.status === "running") {
          const staleMinutes = toStaleMinutes();
          const staleMs = staleMinutes * 60 * 1000;
          const updatedAtMs = new Date(state.updated_at).getTime();
          const staleInMemory =
            Number.isFinite(updatedAtMs) &&
            updatedAtMs > 0 &&
            Date.now() - updatedAtMs > staleMs;

          if (staleInMemory) {
            jobs.delete(jobId);
            if (state.db_run_id) {
              const staleMessage = `Execução marcada como falha por inatividade superior a ${staleMinutes} minuto(s).`;
              await markRunFailed(state.db_run_id, new Date().toISOString(), staleMessage);
            }
          } else {
            return NextResponse.json({
              ...state,
              phase: resolveJobPhase({
                status: state.status,
                processed: state.processed,
                total: state.total,
                currentContact: state.current_contact,
                phase: state.phase,
              }),
              wait_message: state.wait_message || null,
              wait_reason: state.wait_reason || null,
              wait_retry_after_ms: state.wait_retry_after_ms || null,
              wait_attempt: state.wait_attempt || null,
              wait_max_attempts: state.wait_max_attempts || null,
              wait_next_retry_at: state.wait_next_retry_at || null,
              restored_from_db: false,
            });
          }
        } else {
          return NextResponse.json({
            ...state,
            phase: resolveJobPhase({
              status: state.status,
              processed: state.processed,
              total: state.total,
              currentContact: state.current_contact,
              phase: state.phase,
            }),
            wait_message: state.wait_message || null,
            wait_reason: state.wait_reason || null,
            wait_retry_after_ms: state.wait_retry_after_ms || null,
            wait_attempt: state.wait_attempt || null,
            wait_max_attempts: state.wait_max_attempts || null,
            wait_next_retry_at: state.wait_next_retry_at || null,
            restored_from_db: false,
          });
        }
      }
    }

    if (!runId) {
      return NextResponse.json(
        { error: "job_not_found", message: "Job não encontrado ou expirado." },
        { status: 404 },
      );
    }

    let snapshot = await getRunSnapshot(runId);
    if (!snapshot) {
      return NextResponse.json(
        { error: "run_not_found", message: "Execução não encontrada." },
        { status: 404 },
      );
    }

    let runStatus = snapshot.run.status;
    if (runStatus === "running") {
      const staleMinutes = toStaleMinutes();
      const staleMs = staleMinutes * 60 * 1000;
      const heartbeatIso = snapshot.run.last_event_at || snapshot.run.started_at;
      const heartbeatMs = new Date(heartbeatIso).getTime();
      const isStale = Number.isFinite(heartbeatMs) && heartbeatMs > 0 && Date.now() - heartbeatMs > staleMs;

      if (isStale) {
        const staleMessage = `Execução marcada como falha por inatividade superior a ${staleMinutes} minuto(s).`;
        await markRunFailed(runId, new Date().toISOString(), staleMessage);
        const refreshed = await getRunSnapshot(runId);
        if (refreshed) {
          snapshot = refreshed;
          runStatus = refreshed.run.status;
        } else {
          runStatus = "failed";
        }
      }
    }

    const status = runStatus === "running" ? "running" : runStatus === "failed" ? "failed" : "completed";
    const dbCurrentContact =
      status === "running"
        ? await getCurrentContactFromRunEvents(runId)
        : null;
    const dbWaitState =
      status === "running"
        ? await getCurrentWaitStateFromRunEvents(runId)
        : null;
    const failedEvent =
      status === "failed"
        ? await prisma.jobEvent.findFirst({
            where: {
              runId,
              eventType: "run_failed",
            },
            orderBy: { createdAt: "desc" },
            select: {
              payloadJson: true,
            },
          })
        : null;
    const failureMessage =
      failedEvent?.payloadJson && typeof failedEvent.payloadJson === "object"
        ? String((failedEvent.payloadJson as Record<string, unknown>).message || "").trim() || null
        : null;
    const phase = resolveJobPhase({
      status,
      processed: snapshot.run.processed || 0,
      total: snapshot.run.total_conversations || 0,
      currentContact: dbCurrentContact,
      phase: status === "running" && dbWaitState ? "waiting" : status === "running" ? "processing" : status,
    });

    return NextResponse.json({
      job_id: jobId || `db:${runId}`,
      db_run_id: runId,
      date: snapshot.run.date_ref,
      report_date: snapshot.run.report_date || snapshot.run.date_ref,
      trigger_source: snapshot.run.trigger_source || "unknown",
      requested_date: snapshot.run.requested_date || snapshot.run.report_date || snapshot.run.date_ref,
      requested_at: snapshot.run.requested_at || snapshot.run.started_at,
      status,
      phase,
      started_at: snapshot.run.started_at,
      updated_at: snapshot.run.last_event_at || snapshot.run.finished_at || snapshot.run.started_at,
      total: snapshot.run.total_conversations || 0,
      processed: snapshot.run.processed || 0,
      current_contact: dbCurrentContact,
      wait_message: dbWaitState?.wait_message || null,
      wait_reason: dbWaitState?.wait_reason || null,
      wait_retry_after_ms: dbWaitState?.wait_retry_after_ms || null,
      wait_attempt: dbWaitState?.wait_attempt || null,
      wait_max_attempts: dbWaitState?.wait_max_attempts || null,
      wait_next_retry_at: dbWaitState?.wait_next_retry_at || null,
      execution_order: [],
      result:
        status === "completed" && snapshot.report_json
          ? (snapshot.report_json as unknown as ReportPayload)
          : null,
      error: status === "failed" ? failureMessage || "Execução finalizada com falha." : null,
      restored_from_db: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Não foi possível consultar o status do relatório.";
    return NextResponse.json({ error: "report_status_failed", message }, { status: 400 });
  }
}
