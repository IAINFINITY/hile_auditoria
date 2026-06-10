import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import type { AttendantPerformanceSummary } from "@/features/dashboard/shared/types";
import {
  enforceOwnerBucketByInbox,
  resolveResponsibleBucketBySenderName,
  sanitizeBreakdownByInbox,
} from "@/lib/server/audit/ownerBuckets";

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

type ResponseMetric = {
  avg_response_sec: number | null;
  max_response_sec: number | null;
  samples: number;
};

type ResponseMetricMap = Record<Owner, ResponseMetric>;
type Breakdown = Record<Owner, number>;
type ConversationTracking = {
  breakdown: Breakdown;
  lastBucket: Owner | null;
  lastAt: number;
  metrics: ResponseMetricMap;
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

function createBreakdown(): Breakdown {
  return { ia: 0, suellen: 0, samuel: 0 };
}

function createMetrics(): ResponseMetricMap {
  return {
    ia: { avg_response_sec: null, max_response_sec: null, samples: 0 },
    suellen: { avg_response_sec: null, max_response_sec: null, samples: 0 },
    samuel: { avg_response_sec: null, max_response_sec: null, samples: 0 },
  };
}

function sumBreakdown(breakdown: Breakdown): number {
  return Number(breakdown.ia || 0) + Number(breakdown.suellen || 0) + Number(breakdown.samuel || 0);
}

function addBreakdown(target: Breakdown, source: Breakdown) {
  target.ia += Number(source.ia || 0);
  target.suellen += Number(source.suellen || 0);
  target.samuel += Number(source.samuel || 0);
}

function pickOwnerFromBreakdown(breakdown: Breakdown, latestBucket: Owner | null): Owner {
  const ranked = (Object.entries(breakdown) as Array<[Owner, number]>).sort((a, b) => b[1] - a[1]);
  if (ranked[0]?.[1] > 0) return ranked[0][0];
  return latestBucket || "ia";
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

function buildConversationTracking(
  messages: Array<{ role: string; senderName: string | null; createdAt: Date }>,
  inboxId: number | null,
): ConversationTracking {
  const breakdown = createBreakdown();
  const responseAgg = {
    ia: { sum: 0, count: 0, max: 0 },
    suellen: { sum: 0, count: 0, max: 0 },
    samuel: { sum: 0, count: 0, max: 0 },
  };
  let lastBucket: Owner | null = null;
  let lastAt = 0;

  const resolveMessageBucket = (senderName: unknown) => {
    const direct = resolveResponsibleBucketBySenderName(senderName, inboxId);
    if (direct === null) return null;
    return enforceOwnerBucketByInbox(direct, inboxId) as Owner;
  };

  for (const message of messages) {
    const role = String(message.role || "").toUpperCase();
    if (role !== "AGENT") continue;
    const bucket = resolveMessageBucket(message.senderName);
    if (!bucket) continue;
    breakdown[bucket] += 1;
    const at = message.createdAt.getTime();
    if (at > lastAt) {
      lastAt = at;
      lastBucket = bucket;
    }
  }

  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index];
    if (String(current.role || "").toUpperCase() !== "USER") continue;
    const startedAt = current.createdAt.getTime();
    if (!startedAt) continue;

    for (let scan = index + 1; scan < messages.length; scan += 1) {
      const next = messages[scan];
      if (String(next.role || "").toUpperCase() !== "AGENT") continue;
      const bucket = resolveMessageBucket(next.senderName);
      if (!bucket) break;
      const delta = next.createdAt.getTime() - startedAt;
      if (delta > 0) {
        responseAgg[bucket].sum += delta;
        responseAgg[bucket].count += 1;
        responseAgg[bucket].max = Math.max(responseAgg[bucket].max, delta);
      }
      break;
    }
  }

  const metrics = createMetrics();
  for (const owner of OWNERS) {
    const count = responseAgg[owner].count;
    metrics[owner] = {
      avg_response_sec: count > 0 ? Number((responseAgg[owner].sum / count).toFixed(2)) : null,
      max_response_sec: count > 0 ? responseAgg[owner].max : null,
      samples: count,
    };
  }

  return {
    breakdown,
    lastBucket,
    lastAt,
    metrics,
  };
}

function aggregateConversationTracking(
  conversationIds: number[],
  conversationTrackingMap: Map<number, ConversationTracking>,
): ConversationTracking {
  const breakdown = createBreakdown();
  const metricsAgg = {
    ia: { sum: 0, count: 0, max: 0 },
    suellen: { sum: 0, count: 0, max: 0 },
    samuel: { sum: 0, count: 0, max: 0 },
  };
  let lastBucket: Owner | null = null;
  let lastAt = 0;

  for (const rawConversationId of conversationIds) {
    const conversationId = Number(rawConversationId || 0);
    if (!conversationId) continue;
    const tracking = conversationTrackingMap.get(conversationId);
    if (!tracking) continue;
    addBreakdown(breakdown, tracking.breakdown);
    if (tracking.lastBucket && tracking.lastAt > lastAt) {
      lastBucket = tracking.lastBucket;
      lastAt = tracking.lastAt;
    }
    for (const owner of OWNERS) {
      const metric = tracking.metrics[owner];
      const avg = Number(metric.avg_response_sec || 0);
      const samples = Number(metric.samples || 0);
      const max = Number(metric.max_response_sec || 0);
      if (samples > 0 && avg > 0) {
        metricsAgg[owner].sum += avg * samples;
        metricsAgg[owner].count += samples;
      }
      if (max > 0) {
        metricsAgg[owner].max = Math.max(metricsAgg[owner].max, max);
      }
    }
  }

  const metrics = createMetrics();
  for (const owner of OWNERS) {
    const count = metricsAgg[owner].count;
    metrics[owner] = {
      avg_response_sec: count > 0 ? Number((metricsAgg[owner].sum / count).toFixed(2)) : null,
      max_response_sec: count > 0 ? metricsAgg[owner].max : null,
      samples: count,
    };
  }

  return {
    breakdown,
    lastBucket,
    lastAt,
    metrics,
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
        tenantId: true,
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

    const parsedAnalyses: Array<Record<string, unknown>> = [];
    const tenantIds = new Set<string>();
    const conversationIds = new Set<number>();

    for (const run of runs) {
      tenantIds.add(run.tenantId);
      const dateRef = run.dateRef.toISOString().slice(0, 10);
      minDate = minDate === null || dateRef < minDate ? dateRef : minDate;
      maxDate = maxDate === null || dateRef > maxDate ? dateRef : maxDate;

      const reportJson = (run.report?.reportJson as Record<string, unknown> | null) || null;
      const rawAnalysis = (reportJson?.raw_analysis as Record<string, unknown> | undefined) || undefined;
      const analyses = Array.isArray(rawAnalysis?.analyses)
        ? (rawAnalysis.analyses as Array<Record<string, unknown>>)
        : [];
      for (const analysis of analyses) {
        parsedAnalyses.push(analysis);
        for (const rawConversationId of Array.isArray(analysis.conversation_ids) ? analysis.conversation_ids : []) {
          const conversationId = Number(rawConversationId || 0);
          if (conversationId > 0) conversationIds.add(conversationId);
        }
      }
    }

    const conversationTrackingMap = new Map<number, ConversationTracking>();
    if (conversationIds.size > 0 && tenantIds.size > 0) {
      const messageRows = await prisma.message.findMany({
        where: {
          tenantId: {
            in: Array.from(tenantIds.values()),
          },
          conversation: {
            chatwootConversationId: {
              in: Array.from(conversationIds.values()),
            },
          },
        },
        select: {
          role: true,
          senderName: true,
          createdAt: true,
          conversation: {
            select: {
              chatwootConversationId: true,
              channel: {
                select: {
                  chatwootInboxId: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: "asc" }],
      });

      const groupedByConversation = new Map<
        number,
        { inboxId: number | null; messages: Array<{ role: string; senderName: string | null; createdAt: Date }> }
      >();

      for (const row of messageRows) {
        const conversationId = Number(row.conversation?.chatwootConversationId || 0);
        if (!conversationId) continue;
        const current =
          groupedByConversation.get(conversationId) || {
            inboxId: Number(row.conversation?.channel?.chatwootInboxId || 0) || null,
            messages: [],
          };
        current.messages.push({
          role: String(row.role || ""),
          senderName: row.senderName || null,
          createdAt: row.createdAt,
        });
        groupedByConversation.set(conversationId, current);
      }

      for (const [conversationId, group] of groupedByConversation.entries()) {
        conversationTrackingMap.set(conversationId, buildConversationTracking(group.messages, group.inboxId));
      }
    }

    for (const analysis of parsedAnalyses) {
      const rawConversationIds = Array.isArray(analysis.conversation_ids) ? analysis.conversation_ids : [];
      const normalizedConversationIds = rawConversationIds
        .map((rawConversationId) => Number(rawConversationId || 0))
        .filter((conversationId) => conversationId > 0);
      const fallbackTracking = aggregateConversationTracking(normalizedConversationIds, conversationTrackingMap);
      const tracking = (analysis.responsible_tracking as Record<string, unknown> | undefined) || undefined;
      const trackingInboxId = Number(tracking?.source_inbox_id || analysis.inbox_id || 0) || null;
      const storedBreakdown = sanitizeBreakdownByInbox(tracking?.message_breakdown, trackingInboxId);
      const effectiveBreakdown = sumBreakdown(storedBreakdown) > 0 ? storedBreakdown : fallbackTracking.breakdown;
      const ownerRaw = String(tracking?.owner_bucket || "").trim().toLowerCase();
      const owner =
        sumBreakdown(effectiveBreakdown) > 0
          ? pickOwnerFromBreakdown(effectiveBreakdown, fallbackTracking.lastBucket)
          : OWNERS.includes(ownerRaw as Owner)
            ? (enforceOwnerBucketByInbox(ownerRaw, trackingInboxId) as Owner)
            : fallbackTracking.lastBucket || "ia";

      const bucket = bucketMap[owner];
      const answer = String((analysis.analysis as Record<string, unknown> | undefined)?.answer || "");
      const parsed = parseJsonObject(answer);

      bucket.analysesCount += 1;

      const ownerMessageCount = Number(effectiveBreakdown[owner] || 0);
      const fallbackMessageCount = Number(tracking?.message_count_agent || 0);
      bucket.messageCountAgent += ownerMessageCount > 0 ? ownerMessageCount : fallbackMessageCount;
      bucket.improvementsCount += Array.isArray(parsed.pontos_melhoria)
        ? (parsed.pontos_melhoria as unknown[]).length
        : 0;

      const contactKey = String(analysis.contact_key || "").trim();
      if (contactKey) bucket._contacts.add(contactKey);
      for (const conversationId of normalizedConversationIds) {
        bucket._conversations.add(conversationId);
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
      const storedOwnerMetric = (responseMetrics?.[owner] as Record<string, unknown> | undefined) || undefined;
      const storedSamples = Number(storedOwnerMetric?.samples || 0);
      const storedAvg = Number(storedOwnerMetric?.avg_response_sec || 0);
      const storedMax = Number(storedOwnerMetric?.max_response_sec || 0);
      const effectiveMetric =
        storedSamples > 0 && storedAvg > 0
          ? {
              samples: storedSamples,
              avg_response_sec: storedAvg,
              max_response_sec: storedMax > 0 ? storedMax : null,
            }
          : fallbackTracking.metrics[owner];

      const samples = Number(effectiveMetric?.samples || 0);
      const avg = Number(effectiveMetric?.avg_response_sec || 0);
      const max = Number(effectiveMetric?.max_response_sec || 0);

      if (samples > 0 && avg > 0) {
        bucket._sumResponseSec += avg * samples;
        bucket.responseSamples += samples;
      }
      if (max > 0) {
        bucket.maxResponseSec = Math.max(Number(bucket.maxResponseSec || 0), max);
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
