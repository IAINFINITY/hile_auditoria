import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { buildDailyReport } from "@/lib/server/audit/auditService";
import {
  appendRunEvent,
  createRunRecord,
  markRunFailed,
  persistCompletedRun,
  updateRunProgress,
} from "@/lib/server/audit/auditPersistence";
import { getAppConfig, parseDateInput, readJsonBody, requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import { cleanupReportJobs, getReportJobsStore, type ReportJobState } from "@/lib/server/reportJobs";
import type { ReportPayload } from "@/types";

export const runtime = "nodejs";

type ProgressEvent = {
  type?: "contact_start" | "contact_done";
  total?: number;
  sequence?: number;
  contact_name?: string;
  contact_key?: string;
  analysis_key?: string | null;
  conversation_ids?: number[];
  processed?: number;
  success?: boolean;
  error_message?: string;
  error_code?: string | null;
};

export async function POST(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    cleanupReportJobs();

    const config = getAppConfig();
    const body = await readJsonBody<{ date?: string }>(request);
    const date = parseDateInput(body?.date, config.timezone);
    const jobs = getReportJobsStore();

    const runningForDate = [...jobs.values()].find((job) => job.status === "running" && job.date === date);
    if (runningForDate) {
      return NextResponse.json(
        {
          ok: true,
          already_running: true,
          job_id: runningForDate.job_id,
          db_run_id: runningForDate.db_run_id || null,
          status: "running",
          date,
        },
        { status: 202 },
      );
    }

    const jobId = randomUUID();
    const now = new Date().toISOString();

    const initialJob: ReportJobState = {
      job_id: jobId,
      db_run_id: null,
      date,
      status: "running",
      started_at: now,
      updated_at: now,
      total: 0,
      processed: 0,
      current_contact: null,
      execution_order: [],
      result: null,
      error: null,
    };

    jobs.set(jobId, initialJob);
    try {
      initialJob.db_run_id = await createRunRecord({ config, date, startedAtIso: now });
    } catch (error: unknown) {
      jobs.delete(jobId);
      const message =
        error instanceof Error ? error.message : "Não foi possível iniciar o overview para esta data.";
      const code = (error as { code?: string } | null)?.code;
      if (code === "RUN_ALREADY_IN_PROGRESS") {
        return NextResponse.json({ error: "report_already_running", message, date }, { status: 409 });
      }
      throw error;
    }

    void (async () => {
      try {
        const output = await buildDailyReport({
          config,
          date,
          onProgress: (event: ProgressEvent) => {
            const state = jobs.get(jobId);
            if (!state) return;

            state.updated_at = new Date().toISOString();
            state.total = Number(event?.total || state.total || 0);

            if (event?.type === "contact_start") {
              if (state.db_run_id) {
                void appendRunEvent(state.db_run_id, "contact_start", event);
              }
              state.current_contact = {
                sequence: Number(event?.sequence || 0),
                total: Number(event?.total || state.total || 0),
                contact_name: String(event?.contact_name || event?.contact_key || "Contato"),
                contact_key: String(event?.contact_key || ""),
                analysis_key: event?.analysis_key ? String(event.analysis_key) : null,
                conversation_ids: Array.isArray(event?.conversation_ids) ? event.conversation_ids : [],
              };
              return;
            }

            if (event?.type === "contact_done") {
              state.processed = Number(event?.processed || state.processed || 0);
              state.execution_order.push({
                sequence: Number(event?.sequence || state.execution_order.length + 1),
                total: Number(event?.total || state.total || 0),
                contact_key: String(event?.contact_key || ""),
                analysis_key: event?.analysis_key ? String(event.analysis_key) : null,
                contact_name: String(event?.contact_name || event?.contact_key || "Contato"),
                conversation_ids: Array.isArray(event?.conversation_ids) ? event.conversation_ids : [],
                success: Boolean(event?.success),
                processed: Number(event?.processed || state.processed || 0),
                error_message: event?.error_message ? String(event.error_message) : undefined,
                error_code: event?.error_code ? String(event.error_code) : null,
              });
              const processed = Number(event?.processed || state.processed || 0);
              const successCount = state.execution_order.filter((item) => item.success).length;
              const failureCount = Math.max(0, processed - successCount);
              if (state.db_run_id) {
                void appendRunEvent(state.db_run_id, "contact_done", event);
                void updateRunProgress(state.db_run_id, {
                  total: Number(event?.total || state.total || 0),
                  processed,
                  successCount,
                  failureCount,
                });
              }
              state.current_contact = null;
            }
          },
        });

        const state = jobs.get(jobId);
        if (!state) return;
        const finishedAt = new Date().toISOString();
        state.status = "completed";
        state.updated_at = finishedAt;
        state.result = {
          ...output,
          summary: {
            ...output.summary,
            execution_order_count: state.execution_order.length,
          },
          execution_order: state.execution_order,
        };
        state.error = null;
        state.current_contact = null;

        if (state.db_run_id) {
          await persistCompletedRun({
            runId: state.db_run_id,
            config,
            date,
            finishedAtIso: finishedAt,
            output: state.result as ReportPayload,
          });
          await appendRunEvent(state.db_run_id, "run_completed", {
            processed: state.processed,
            total: state.total,
          });
        }
      } catch (error: unknown) {
        const state = jobs.get(jobId);
        if (!state) return;
        const finishedAt = new Date().toISOString();
        state.status = "failed";
        state.updated_at = finishedAt;
        state.error = error instanceof Error ? error.message : "Falha ao gerar relatório.";
        state.current_contact = null;
        if (state.db_run_id) {
          await markRunFailed(state.db_run_id, finishedAt, state.error);
        }
      }
    })();

    return NextResponse.json({ ok: true, job_id: jobId, status: "running", date }, { status: 202 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Não foi possível iniciar o relatório.";
    return NextResponse.json({ error: "report_start_failed", message }, { status: 400 });
  }
}
