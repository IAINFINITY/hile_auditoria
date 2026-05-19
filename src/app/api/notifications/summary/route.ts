import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getLatestRunByDate } from "@/lib/server/audit/auditPersistence";
import { getAppConfig, parseDateInput, requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const config = getAppConfig();
    const { searchParams } = new URL(request.url);
    const date = parseDateInput(searchParams.get("date"), config.timezone);

    const latestRun = await getLatestRunByDate(date);
    if (!latestRun) {
      return NextResponse.json({
        date,
        latest_completed_run: null,
        clients_snapshot: {
          run_id: null,
          total: 0,
          last_updated_at: null,
          signature: null,
        },
      });
    }

    const aggregate = await prisma.clientRecord.aggregate({
      where: { runId: latestRun.id },
      _count: { _all: true },
      _max: { updatedAt: true },
    });

    const total = Number(aggregate._count?._all || 0);
    const lastUpdatedAt = aggregate._max?.updatedAt ? aggregate._max.updatedAt.toISOString() : null;
    const signature = `${latestRun.id}:${total}:${lastUpdatedAt || ""}`;

    return NextResponse.json({
      date,
      latest_completed_run: {
        id: latestRun.id,
        started_at: latestRun.started_at,
        finished_at: latestRun.finished_at,
      },
      clients_snapshot: {
        run_id: latestRun.id,
        total,
        last_updated_at: lastUpdatedAt,
        signature,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Não foi possível obter o resumo de notificações.";
    return NextResponse.json({ error: "notifications_summary_failed", message }, { status: 400 });
  }
}

