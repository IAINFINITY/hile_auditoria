import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { buildDailyReport } from "@/lib/server/audit/auditService";
import {
  appendRunEvent,
  createRunRecord,
  getRunningRunByDate,
  getSyncCheckpoint,
  markRunFailed,
  persistCompletedRun,
  updateRunProgress,
} from "@/lib/server/audit/auditPersistence";
import { resolveTenantAndChannel } from "@/lib/server/audit/persistence/helpers";
import { getAppConfig, parseDateInput } from "@/lib/server/apiUtils";
import type { ReportPayload } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 300;

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

function isCronAuthorized(request: Request): boolean {
  const cronHeader = String(request.headers.get("x-vercel-cron") || "").trim();
  if (cronHeader === "1") return true;

  const expectedSecret = String(process.env.CRON_SECRET || "").trim();
  if (!expectedSecret) return false;

  const providedSecret =
    String(request.headers.get("x-cron-secret") || "").trim() ||
    new URL(request.url).searchParams.get("secret")?.trim() ||
    "";

  return providedSecret.length > 0 && providedSecret === expectedSecret;
}

async function handleAutoSync(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json(
        { error: "unauthorized", message: "Cron não autorizado." },
        { status: 401 },
      );
    }

    const config = getAppConfig();
    const { searchParams } = new URL(request.url);
    const date = parseDateInput(searchParams.get("date"), config.timezone);
    const force = ["1", "true", "yes"].includes(String(searchParams.get("force") || "").trim().toLowerCase());
    const reportLike = {
      account: {
        id: Number(config.chatwoot.accountId || 0),
        name: config.chatwoot.groupName,
        role: null,
      },
      inbox: {
        id: Number(config.chatwoot.inboxId || 0),
        name: config.chatwoot.inboxName,
        provider: config.chatwoot.inboxProvider,
        channel_type: null,
        phone_number: null,
      },
    } as unknown as ReportPayload;
    const { tenant, channel } = await resolveTenantAndChannel(prisma, config, reportLike);
    const checkpoint = await getSyncCheckpoint({
      tenantId: tenant.id,
      channelId: channel.id,
    }).catch(() => null);

    const shouldSkip =
      !force &&
      checkpoint?.lastSyncedAt &&
      Date.now() - new Date(checkpoint.lastSyncedAt).getTime() < 55 * 60 * 1000;

    if (shouldSkip) {
      return NextResponse.json(
        {
          ok: true,
          skipped: true,
          job_id: null,
          status: "skipped",
          date,
          report_date: date,
          message: "Sincronização recente detectada; execução ignorada.",
        },
        { status: 200 },
      );
    }

    const startedAt = new Date().toISOString();
    let runId: string;
    try {
      runId = await createRunRecord({ config, date, startedAtIso: startedAt });
      await appendRunEvent(runId, "run_requested", {
        source: "auto_sync",
        requested_date: date,
        requested_at: startedAt,
        force,
        trigger: "cron",
      });
    } catch (error: unknown) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "RUN_ALREADY_IN_PROGRESS") {
        const runningDbRun = await getRunningRunByDate(date);
        return NextResponse.json(
          {
            ok: true,
            already_running: true,
            job_id: runningDbRun?.id ? `db:${runningDbRun.id}` : null,
            db_run_id: runningDbRun?.id || null,
            status: "running",
            date,
            report_date: date,
            mode: "auto_sync",
            message: "Existe uma sincronização em andamento para esta data.",
          },
          { status: 202 },
        );
      }
      throw error;
    }

    const fireAndForget = (promise: Promise<unknown>, label: string) => {
      void promise.catch((error) => {
        console.warn(`[report-day/auto-sync] async failure in ${label}:`, error);
      });
    };

    after(async () => {
      try {
        const output = await buildDailyReport({
          config,
          date,
          mode: "reuse",
          onProgress: (event: ProgressEvent) => {
            if (!event?.type) return;

            if (event.type === "contact_start") {
              fireAndForget(appendRunEvent(runId, "contact_start", event), "appendRunEvent(contact_start)");
              return;
            }

            if (event.type === "contact_done") {
              fireAndForget(appendRunEvent(runId, "contact_done", event), "appendRunEvent(contact_done)");
              fireAndForget(
                updateRunProgress(runId, {
                  total: Number(event.total || 0),
                  processed: Number(event.processed || 0),
                }),
                "updateRunProgress",
              );
            }
          },
        });
        const reportOutput = output as ReportPayload;

        const finishedAt = new Date().toISOString();
        const result = {
          ...reportOutput,
          summary: {
            ...reportOutput.summary,
            execution_order_count: reportOutput.execution_order?.length || 0,
          },
        };

        await persistCompletedRun({
          runId,
          config,
          date,
          finishedAtIso: finishedAt,
          output: result as ReportPayload,
        });
        await appendRunEvent(runId, "run_completed", {
          processed: result.summary.processed,
          total: result.summary.total_to_process,
          source: "cron",
          requested_date: date,
        });
      } catch (error) {
        const finishedAt = new Date().toISOString();
        const message = error instanceof Error ? error.message : "Falha ao gerar sincronização automática.";
        try {
          await markRunFailed(runId, finishedAt, message);
        } catch (markError) {
          console.error("[report-day/auto-sync] failed to mark run as failed:", markError);
          await prisma.analysisRun.updateMany({
            where: { id: runId },
            data: {
              status: "failed",
              finishedAt: new Date(finishedAt),
            },
          });
        }
      }
    });

    return NextResponse.json(
      {
        ok: true,
        job_id: runId,
        status: "running",
        date,
        report_date: date,
        mode: "auto_sync",
      },
      { status: 202 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao iniciar a sincronização automática.";
    return NextResponse.json({ error: "auto_sync_failed", message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  return handleAutoSync(request);
}

export async function POST(request: Request) {
  return handleAutoSync(request);
}
