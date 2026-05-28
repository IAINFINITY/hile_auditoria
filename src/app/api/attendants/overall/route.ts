import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import type { AttendantPerformanceSummary } from "@/features/dashboard/shared/types";
import { enforceOwnerBucketByInbox, sanitizeBreakdownByInbox } from "@/lib/server/audit/ownerBuckets";

export const runtime = "nodejs";

type Owner = "ia" | "suellen" | "samuel";

type OwnerBucket = {
  owner: Owner;
  ownerLabel: string;
  analysesCount: number;
  contactsCount: number;
  conversationsCount: number;
  messageCountAgent: number;
  gapsCount: number;
  criticalGapsCount: number;
  improvementsCount: number;
  avgResponseSec: number | null;
  maxResponseSec: number | null;
  responseSamples: number;
  _sumResponseSec: number;
  _contacts: Set<string>;
  _conversations: Set<number>;
};

const OWNERS: Owner[] = ["ia", "suellen", "samuel"];

function normalizeOwnerScope(value: string | null): "all" | Owner {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ia" || normalized === "suellen" || normalized === "samuel") return normalized;
  return "all";
}

function parseSeverity(value: unknown): "critical" | "high" | "medium" | "low" | "info" {
  const normalized = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (normalized.includes("crit")) return "critical";
  if (normalized.includes("high") || normalized.includes("alt")) return "high";
  if (normalized.includes("medium") || normalized.includes("med")) return "medium";
  if (normalized.includes("low") || normalized.includes("baix")) return "low";
  return "info";
}

function parseJsonObject(value: string): Record<string, unknown> {
  const trimmed = String(value || "").trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function createBucket(owner: Owner): OwnerBucket {
  return {
    owner,
    ownerLabel: owner === "ia" ? "IA" : owner === "suellen" ? "Comercial Suellen" : "Comercial Samuel",
    analysesCount: 0,
    contactsCount: 0,
    conversationsCount: 0,
    messageCountAgent: 0,
    gapsCount: 0,
    criticalGapsCount: 0,
    improvementsCount: 0,
    avgResponseSec: null,
    maxResponseSec: null,
    responseSamples: 0,
    _sumResponseSec: 0,
    _contacts: new Set<string>(),
    _conversations: new Set<number>(),
  };
}

function toSummary(bucketMap: Record<Owner, OwnerBucket>): AttendantPerformanceSummary {
  const entries = OWNERS.map((owner) => {
    const bucket = bucketMap[owner];
    return {
      owner: bucket.owner,
      ownerLabel: bucket.ownerLabel,
      analysesCount: bucket.analysesCount,
      contactsCount: bucket._contacts.size,
      conversationsCount: bucket._conversations.size,
      messageCountAgent: bucket.messageCountAgent,
      gapsCount: bucket.gapsCount,
      criticalGapsCount: bucket.criticalGapsCount,
      improvementsCount: bucket.improvementsCount,
      avgResponseSec:
        bucket.responseSamples > 0
          ? Number((bucket._sumResponseSec / bucket.responseSamples).toFixed(2))
          : null,
      maxResponseSec: bucket.maxResponseSec && bucket.maxResponseSec > 0 ? bucket.maxResponseSec : null,
      responseSamples: bucket.responseSamples,
    };
  });

  return {
    entries,
    totalAnalyses: entries.reduce((acc, entry) => acc + entry.analysesCount, 0),
    totalMessages: entries.reduce((acc, entry) => acc + entry.messageCountAgent, 0),
    totalGaps: entries.reduce((acc, entry) => acc + entry.gapsCount, 0),
    totalCriticalGaps: entries.reduce((acc, entry) => acc + entry.criticalGapsCount, 0),
  };
}

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const takeInput = Number(searchParams.get("take") || 1000);
    const ownerScope = normalizeOwnerScope(searchParams.get("owner"));
    const take = Number.isFinite(takeInput) && takeInput > 0 ? Math.min(2000, takeInput) : 1000;
    const from = String(searchParams.get("from") || "").trim();
    const to = String(searchParams.get("to") || "").trim();

    const dateRefWhere: { gte?: Date; lte?: Date } = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) dateRefWhere.gte = new Date(`${from}T00:00:00.000Z`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) dateRefWhere.lte = new Date(`${to}T23:59:59.999Z`);

    const runs = await prisma.analysisRun.findMany({
      where: {
        status: RunStatus.completed,
        report: { isNot: null },
        ...(dateRefWhere.gte || dateRefWhere.lte ? { dateRef: dateRefWhere } : {}),
      },
      orderBy: { startedAt: "desc" },
      take,
      select: {
        dateRef: true,
        report: {
          select: {
            reportJson: true,
          },
        },
      },
    });

    const bucketMap: Record<Owner, OwnerBucket> = {
      ia: createBucket("ia"),
      suellen: createBucket("suellen"),
      samuel: createBucket("samuel"),
    };

    let minDate: string | null = null;
    let maxDate: string | null = null;

    for (const run of runs) {
      const dateRef = run.dateRef.toISOString().slice(0, 10);
      minDate = minDate === null || dateRef < minDate ? dateRef : minDate;
      maxDate = maxDate === null || dateRef > maxDate ? dateRef : maxDate;

      const reportJson = (run.report?.reportJson as Record<string, unknown> | null) || null;
      const rawAnalysis = (reportJson?.raw_analysis as Record<string, unknown> | undefined) || undefined;
      const analyses = Array.isArray(rawAnalysis?.analyses)
        ? (rawAnalysis.analyses as Array<Record<string, unknown>>)
        : [];

      for (const analysis of analyses) {
        const tracking = (analysis.responsible_tracking as Record<string, unknown> | undefined) || undefined;
        const trackingInboxId = Number(tracking?.source_inbox_id || analysis.inbox_id || 0) || null;
        const breakdown = sanitizeBreakdownByInbox(tracking?.message_breakdown, trackingInboxId);
        const ownerRaw = String(tracking?.owner_bucket || "").trim().toLowerCase();
        const owner = OWNERS.includes(ownerRaw as Owner)
          ? (enforceOwnerBucketByInbox(ownerRaw, trackingInboxId) as Owner)
          : (() => {
              const ranked = [
                { key: "ia" as const, count: Number(breakdown.ia || 0) },
                { key: "suellen" as const, count: Number(breakdown.suellen || 0) },
                { key: "samuel" as const, count: Number(breakdown.samuel || 0) },
              ].sort((a, b) => b.count - a.count);
              return ranked[0]?.count > 0 ? ranked[0].key : "ia";
            })();
        const bucket = bucketMap[owner];
        const answer = String((analysis.analysis as Record<string, unknown> | undefined)?.answer || "");
        const parsed = parseJsonObject(answer);

        bucket.analysesCount += 1;
        const ownerMessageCount = Number((breakdown as Record<Owner, number>)[owner] || 0);
        const fallbackMessageCount = Number(tracking?.message_count_agent || 0);
        bucket.messageCountAgent += ownerMessageCount > 0 ? ownerMessageCount : fallbackMessageCount;
        bucket.improvementsCount += Array.isArray(parsed.pontos_melhoria)
          ? (parsed.pontos_melhoria as unknown[]).length
          : 0;

        const contactKey = String(analysis.contact_key || "").trim();
        if (contactKey) bucket._contacts.add(contactKey);
        const conversationIds = Array.isArray(analysis.conversation_ids) ? analysis.conversation_ids : [];
        for (const rawConversationId of conversationIds) {
          const conversationId = Number(rawConversationId || 0);
          if (conversationId > 0) bucket._conversations.add(conversationId);
        }

        const gaps = Array.isArray(parsed.gaps_operacionais)
          ? (parsed.gaps_operacionais as Array<Record<string, unknown>>)
          : [];
        bucket.gapsCount += gaps.length;
        for (const gap of gaps) {
          const severity = parseSeverity(gap?.severidade || gap?.severity || gap?.nivel || gap?.prioridade);
          if (severity === "critical") bucket.criticalGapsCount += 1;
        }

        const responseMetrics = (tracking?.response_metrics as Record<string, unknown> | undefined) || undefined;
        const ownerMetrics = (responseMetrics?.[owner] as Record<string, unknown> | undefined) || undefined;
        const samples = Number(ownerMetrics?.samples || 0);
        const avg = Number(ownerMetrics?.avg_response_sec || 0);
        const max = Number(ownerMetrics?.max_response_sec || 0);

        if (samples > 0 && avg > 0) {
          bucket._sumResponseSec += avg * samples;
          bucket.responseSamples += samples;
        }
        if (max > 0) {
          bucket.maxResponseSec = Math.max(Number(bucket.maxResponseSec || 0), max);
        }
      }
    }

    const summary = toSummary(bucketMap);
    const filteredEntries = ownerScope === "all" ? summary.entries : summary.entries.filter((item) => item.owner === ownerScope);
    const filteredSummary: AttendantPerformanceSummary = {
      entries: filteredEntries,
      totalAnalyses: filteredEntries.reduce((acc, entry) => acc + entry.analysesCount, 0),
      totalMessages: filteredEntries.reduce((acc, entry) => acc + entry.messageCountAgent, 0),
      totalGaps: filteredEntries.reduce((acc, entry) => acc + entry.gapsCount, 0),
      totalCriticalGaps: filteredEntries.reduce((acc, entry) => acc + entry.criticalGapsCount, 0),
    };

    return NextResponse.json({
      total_runs: runs.length,
      date_range: { from: minDate, to: maxDate },
      owner_scope: ownerScope,
      summary: filteredSummary,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao carregar atendentes (geral).";
    return NextResponse.json({ error: "attendants_overall_failed", message }, { status: 400 });
  }
}
