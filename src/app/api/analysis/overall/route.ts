import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import type { Severity } from "@/types";
import { prisma } from "@/lib/db/prisma";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

function normalizeSeverity(value: unknown): Severity {
  const text = String(value || "").toLowerCase();
  if (text.includes("critical") || text.includes("crit")) return "critical";
  if (text.includes("high") || text.includes("alto")) return "high";
  if (text.includes("medium") || text.includes("medio") || text.includes("médio")) return "medium";
  if (text.includes("low") || text.includes("baixo")) return "low";
  return "info";
}

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
        totalConversations: true,
        processed: true,
        report: {
          select: {
            reportJson: true,
          },
        },
      },
    });
    const totalRuns = await prisma.analysisRun.count({ where });

    const severitySnapshot: Record<Severity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    const contextItems: Array<{
      id: string;
      date: string;
      contact_name: string;
      summary: string;
      severity: Severity;
    }> = [];
    const uniqueContacts = new Set<string>();
    let totalMessages = 0;
    let finalizedCount = 0;
    let continuedCount = 0;
    let conversationsScanned = 0;
    let conversationsAnalyzed = 0;
    let firstDate: string | null = null;
    let lastDate: string | null = null;

    for (const run of runs) {
      const dateRef = run.dateRef.toISOString().slice(0, 10);
      firstDate = firstDate === null || dateRef < firstDate ? dateRef : firstDate;
      lastDate = lastDate === null || dateRef > lastDate ? dateRef : lastDate;
      conversationsScanned += Math.max(0, Number(run.totalConversations || 0));
      conversationsAnalyzed += Math.max(0, Number(run.processed || 0));

      const reportJson = (run.report?.reportJson as Record<string, unknown> | null) || null;
      const overviewObj = (reportJson?.overview as Record<string, unknown> | undefined)?.overview as
        | Record<string, unknown>
        | undefined;
      totalMessages += Math.max(0, Number(overviewObj?.total_messages_day || 0));
      finalizedCount += Math.max(0, Number(overviewObj?.finalized_count || 0));
      continuedCount += Math.max(0, Number(overviewObj?.continued_count || 0));

      const logs = Array.isArray(reportJson?.logs) ? (reportJson?.logs as Array<Record<string, unknown>>) : [];
      logs.forEach((log, index) => {
        const contactKey = String(log.contact_key || "").trim();
        if (contactKey) uniqueContacts.add(contactKey);

        const severity = normalizeSeverity(log.risk_level);
        severitySnapshot[severity] += 1;

        const summary = String(log.summary || "").trim();
        if (!summary) return;
        contextItems.push({
          id: `${run.id}-${index + 1}`,
          date: dateRef,
          contact_name: String(log.contact_name || log.contact_key || "Contato"),
          summary,
          severity,
        });
      });
    }

    const criticalInsights = severitySnapshot.critical;
    const nonCriticalInsights =
      severitySnapshot.high + severitySnapshot.medium + severitySnapshot.low + severitySnapshot.info;

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
      overview: {
        conversations_scanned: conversationsScanned,
        conversations_total_analyzed: conversationsAnalyzed,
        unique_contacts: uniqueContacts.size,
        critical_insights_count: criticalInsights,
        non_critical_insights_count: nonCriticalInsights,
        total_messages: totalMessages,
        finalized_count: finalizedCount,
        continued_count: continuedCount,
      },
      severity_snapshot: severitySnapshot,
      context_items: contextItems
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        .slice(0, 200),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao carregar análise total.";
    return NextResponse.json({ error: "analysis_overall_failed", message }, { status: 400 });
  }
}
