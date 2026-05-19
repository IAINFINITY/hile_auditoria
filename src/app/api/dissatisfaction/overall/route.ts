import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import type { AnalysisItem } from "@/types";
import { prisma } from "@/lib/db/prisma";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import { extractOperationalAlerts } from "@/features/dashboard/hooks/controller/operationalSignals";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const takeInput = Number(searchParams.get("take") || searchParams.get("limit") || 300);
    const pageInput = Number(searchParams.get("page") || 1);
    const take = Number.isFinite(takeInput) && takeInput > 0 ? Math.min(1000, takeInput) : 300;
    const page = Number.isFinite(pageInput) && pageInput > 0 ? Math.floor(pageInput) : 1;
    const skip = (page - 1) * take;
    const from = String(searchParams.get("from") || "").trim();
    const to = String(searchParams.get("to") || "").trim();
    const dateRefWhere: { gte?: Date; lte?: Date } = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) dateRefWhere.gte = new Date(`${from}T00:00:00.000Z`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) dateRefWhere.lte = new Date(`${to}T23:59:59.999Z`);

    const where = {
      status: RunStatus.completed,
      report: { isNot: null },
      ...(dateRefWhere.gte || dateRefWhere.lte ? { dateRef: dateRefWhere } : {}),
    };

    const runs = await prisma.analysisRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        dateRef: true,
        report: {
          select: {
            reportJson: true,
          },
        },
      },
    });
    const totalRuns = await prisma.analysisRun.count({ where });

    const allAnalyses: AnalysisItem[] = [];
    let firstDate: string | null = null;
    let lastDate: string | null = null;

    for (const run of runs) {
      const dateRef = run.dateRef.toISOString().slice(0, 10);
      firstDate = firstDate === null || dateRef < firstDate ? dateRef : firstDate;
      lastDate = lastDate === null || dateRef > lastDate ? dateRef : lastDate;
      const reportJson = (run.report?.reportJson as Record<string, unknown> | null) || null;
      const rawAnalysis = (reportJson?.raw_analysis as Record<string, unknown> | undefined) || undefined;
      const analyses = Array.isArray(rawAnalysis?.analyses)
        ? (rawAnalysis.analyses as AnalysisItem[])
        : [];
      allAnalyses.push(...analyses);
    }

    const alerts = extractOperationalAlerts(allAnalyses)
      .filter((item) => item.type === "desengajamento")
      .sort((a, b) => {
        const aTime = itemTime(a.occurredAt);
        const bTime = itemTime(b.occurredAt);
        return bTime - aTime;
      });

    const deduped: typeof alerts = [];
    const seen = new Set<string>();
    for (const item of alerts) {
      const fingerprint = `${item.conversationId}|${String(item.occurredAt || "")}|${String(item.excerpt || "").trim()}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      deduped.push(item);
    }

    const uniqueContacts = new Set(
      deduped
        .map((item) => String(item.contactName || "").trim())
        .filter(Boolean),
    ).size;

    return NextResponse.json({
      total_runs: runs.length,
      total_runs_available: totalRuns,
      pagination: {
        page,
        take,
        total_pages: Math.max(1, Math.ceil(totalRuns / take)),
      },
      date_range: {
        from: firstDate,
        to: lastDate,
      },
      summary: {
        total: deduped.length,
        critical: deduped.filter((item) => item.severity === "critical").length,
        high: deduped.filter((item) => item.severity === "high").length,
        medium: deduped.filter((item) => item.severity === "medium").length,
        unique_contacts: uniqueContacts,
      },
      alerts: deduped.slice(0, 500),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao carregar insatisfação geral.";
    return NextResponse.json({ error: "dissatisfaction_overall_failed", message }, { status: 400 });
  }
}

function itemTime(value: string | null | undefined): number {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
