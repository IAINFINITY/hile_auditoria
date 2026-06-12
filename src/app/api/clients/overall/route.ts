import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { ClientRecordItem, Severity } from "@/types";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import {
  enforceOwnerBucketByInbox,
  resolveResponsibleBucketBySenderName,
  sanitizeBreakdownByInbox,
} from "@/lib/server/audit/ownerBuckets";

export const runtime = "nodejs";

type OwnerScope = "all" | "ia" | "suellen" | "samuel";
type ResponsibleBucket = "ia" | "suellen" | "samuel";
type PipelineBlock = "entrada" | "remarketing" | "atencao" | "resolvido";

type ResponsibleBreakdown = {
  ia: number;
  suellen: number;
  samuel: number;
};

type ConversationResponsibleSnapshot = {
  counts: ResponsibleBreakdown;
  last: { bucket: ResponsibleBucket; at: number } | null;
};

type MergedClientState = {
  phonePk: string;
  contactName: string;
  companyName: string;
  cnpj: string;
  labels: Set<string>;
  conversationIds: Set<number>;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  firstIssueAt: Date | null;
  lastIssueAt: Date | null;
  resolvedAt: Date | null;
  latestUpdatedAt: Date | null;
  latestStatus: string;
  highestSeverity: Severity;
  storedBreakdown: ResponsibleBreakdown;
};

function sanitizeClientErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  const normalized = String(message || "").toLowerCase();
  if (
    normalized.includes("quota") ||
    normalized.includes("rate limit") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("openai") ||
    normalized.includes("dify")
  ) {
    return "Nao foi possivel carregar os clientes agora. Tente novamente em instantes.";
  }
  return String(message || fallback || "Nao foi possivel carregar os clientes agora.");
}

function normalizeOwnerScope(value: string | null): OwnerScope {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ia" || normalized === "suellen" || normalized === "samuel") return normalized;
  return "all";
}

function resolveResponsibleBucket(senderName: unknown, inboxId: unknown): ResponsibleBucket | null {
  return resolveResponsibleBucketBySenderName(senderName, inboxId);
}

function responsibleLabel(bucket: ResponsibleBucket): string {
  if (bucket === "samuel") return "Comercial Samuel";
  if (bucket === "suellen") return "Comercial Suellen";
  return "IA";
}

function toTitleCaseName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeSeverity(value: unknown): Severity {
  const raw = String(value || "").toLowerCase().trim();
  if (raw === "critical" || raw.includes("crit")) return "critical";
  if (raw === "high" || raw.includes("alt")) return "high";
  if (raw === "medium" || raw.includes("med")) return "medium";
  if (raw === "low" || raw.includes("baix")) return "low";
  return "info";
}

function normalizeStatus(value: unknown): string {
  const raw = String(value || "").toLowerCase().trim();
  if (raw === "resolvido") return "resolvido";
  if (raw === "atencao") return "atencao";
  return "aberto";
}

function normalizeLabelKey(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasExitLabel(labels: string[]): boolean {
  const normalized = (labels || []).map((item) => normalizeLabelKey(item));
  return normalized.includes("lead_agendado") || normalized.includes("pausar_ia");
}

function hasRemarketingLabel(labels: string[]): boolean {
  return (labels || []).map((item) => normalizeLabelKey(item)).includes("ia_remarketing");
}

function severityRank(value: Severity): number {
  if (value === "critical") return 4;
  if (value === "high") return 3;
  if (value === "medium") return 2;
  if (value === "low") return 1;
  return 0;
}

function createEmptyBreakdown(): ResponsibleBreakdown {
  return { ia: 0, suellen: 0, samuel: 0 };
}

function sumBreakdown(values: ResponsibleBreakdown): number {
  return Number(values.ia || 0) + Number(values.suellen || 0) + Number(values.samuel || 0);
}

function addBreakdown(target: ResponsibleBreakdown, source: ResponsibleBreakdown) {
  target.ia += Number(source.ia || 0);
  target.suellen += Number(source.suellen || 0);
  target.samuel += Number(source.samuel || 0);
}

function pickResponsibleBucketFromBreakdown(
  breakdown: ResponsibleBreakdown,
  latestBucket: ResponsibleBucket | null,
): ResponsibleBucket {
  const ranked = (Object.entries(breakdown) as Array<[ResponsibleBucket, number]>).sort((a, b) => b[1] - a[1]);
  if (ranked[0]?.[1] > 0) return ranked[0][0];
  return latestBucket || "ia";
}

function selectPreferredText(current: string, incoming: string): string {
  const next = String(incoming || "").trim();
  if (!next) return current;
  if (!current) return next;
  return next.length > current.length ? next : current;
}

function pickEarlier(current: Date | null, incoming: Date | null): Date | null {
  if (!incoming) return current;
  if (!current) return incoming;
  return incoming.getTime() < current.getTime() ? incoming : current;
}

function pickLater(current: Date | null, incoming: Date | null): Date | null {
  if (!incoming) return current;
  if (!current) return incoming;
  return incoming.getTime() > current.getTime() ? incoming : current;
}

function derivePipelineState(params: {
  labels: string[];
  currentStatus: string;
  currentSeverity: Severity;
}): {
  status: "aberto" | "atencao" | "resolvido";
  pipelineBlock: PipelineBlock;
  remarketing: ClientRecordItem["remarketing"];
} {
  const normalizedStatus = normalizeStatus(params.currentStatus);
  const resolved = normalizedStatus === "resolvido" || hasExitLabel(params.labels);
  const attention =
    normalizedStatus === "atencao" || params.currentSeverity === "critical" || params.currentSeverity === "high";
  const remarketing = hasRemarketingLabel(params.labels);

  if (resolved) {
    return { status: "resolvido", pipelineBlock: "resolvido", remarketing: null };
  }
  if (attention) {
    return { status: "atencao", pipelineBlock: "atencao", remarketing: null };
  }
  if (remarketing) {
    return {
      status: "aberto",
      pipelineBlock: "remarketing",
      remarketing: {
        eligible: true,
        pendingHours: null,
        reason: "Etiqueta ia_remarketing identificada no consolidado geral.",
        ruleMatched: "label_ia_remarketing",
      },
    };
  }
  return { status: "aberto", pipelineBlock: "entrada", remarketing: null };
}

function deriveClientPhase(companyName: string, cnpj: string): { phase: "inicial" | "intermediario"; reason: string } {
  if (String(cnpj || "").trim()) {
    return {
      phase: "intermediario",
      reason: "CNPJ identificado no consolidado geral.",
    };
  }
  if (String(companyName || "").trim()) {
    return {
      phase: "intermediario",
      reason: "Nome de empresa identificado no consolidado geral.",
    };
  }
  return {
    phase: "inicial",
    reason: "Sem sinais estruturais suficientes no consolidado geral.",
  };
}

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const takeInput = Number(searchParams.get("take") || 500);
    const ownerScope = normalizeOwnerScope(searchParams.get("owner"));
    const take = Number.isFinite(takeInput) && takeInput > 0 ? Math.min(2000, takeInput) : 500;
    const from = String(searchParams.get("from") || "").trim();
    const to = String(searchParams.get("to") || "").trim();
    const lastSeenWhere: { gte?: Date; lte?: Date } = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) lastSeenWhere.gte = new Date(`${from}T00:00:00.000Z`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) lastSeenWhere.lte = new Date(`${to}T23:59:59.999Z`);

    const latestRun = await prisma.analysisRun.findFirst({
      where: { status: RunStatus.completed },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        startedAt: true,
      },
    });

    if (!latestRun) {
      return NextResponse.json({
        date: "overall",
        runId: null,
        generatedAt: null,
        source: "client_states_overall",
        items: [],
      });
    }

    const states = await prisma.clientState.findMany({
      where: {
        tenantId: latestRun.tenantId,
        ...(lastSeenWhere.gte || lastSeenWhere.lte ? { lastSeenAt: lastSeenWhere } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        phonePk: true,
        channelId: true,
        contactName: true,
        companyName: true,
        cnpj: true,
        firstSeenAt: true,
        lastSeenAt: true,
        firstIssueAt: true,
        lastIssueAt: true,
        resolvedAt: true,
        currentStatus: true,
        currentSeverity: true,
        currentLabels: true,
        openConversationIds: true,
        responsibleBucket: true,
        responsibleLabel: true,
        responsibleMessageCount: true,
        responsibleMessageBreakdown: true,
        updatedAt: true,
        channel: {
          select: {
            chatwootInboxId: true,
          },
        },
      },
    });

    const mergedStates = new Map<string, MergedClientState>();
    for (const state of states) {
      const phonePk = String(state.phonePk || "").trim();
      if (!phonePk) continue;
      const current =
        mergedStates.get(phonePk) ||
        ({
          phonePk,
          contactName: "",
          companyName: "",
          cnpj: "",
          labels: new Set<string>(),
          conversationIds: new Set<number>(),
          firstSeenAt: null,
          lastSeenAt: null,
          firstIssueAt: null,
          lastIssueAt: null,
          resolvedAt: null,
          latestUpdatedAt: null,
          latestStatus: "aberto",
          highestSeverity: "info",
          storedBreakdown: createEmptyBreakdown(),
        } satisfies MergedClientState);

      current.contactName = selectPreferredText(current.contactName, String(state.contactName || "").trim());
      current.companyName = selectPreferredText(current.companyName, String(state.companyName || "").trim());
      current.cnpj = selectPreferredText(current.cnpj, String(state.cnpj || "").trim());
      current.firstSeenAt = pickEarlier(current.firstSeenAt, state.firstSeenAt);
      current.lastSeenAt = pickLater(current.lastSeenAt, state.lastSeenAt);
      current.firstIssueAt = pickEarlier(current.firstIssueAt, state.firstIssueAt);
      current.lastIssueAt = pickLater(current.lastIssueAt, state.lastIssueAt);
      current.resolvedAt = pickLater(current.resolvedAt, state.resolvedAt);

      if (!current.latestUpdatedAt || state.updatedAt.getTime() > current.latestUpdatedAt.getTime()) {
        current.latestUpdatedAt = state.updatedAt;
        current.latestStatus = String(state.currentStatus || "aberto");
      }

      const severity = normalizeSeverity(state.currentSeverity);
      if (severityRank(severity) > severityRank(current.highestSeverity)) {
        current.highestSeverity = severity;
      }

      for (const label of Array.isArray(state.currentLabels) ? state.currentLabels : []) {
        const text = String(label || "").trim();
        if (text) current.labels.add(text);
      }

      for (const rawConversationId of Array.isArray(state.openConversationIds) ? state.openConversationIds : []) {
        const conversationId = Number(rawConversationId || 0);
        if (conversationId > 0) current.conversationIds.add(conversationId);
      }

      const inboxId = Number(state.channel?.chatwootInboxId || 0) || null;
      const storedBreakdownRaw =
        state.responsibleMessageBreakdown && typeof state.responsibleMessageBreakdown === "object"
          ? (state.responsibleMessageBreakdown as Record<string, unknown>)
          : null;
      if (storedBreakdownRaw) {
        addBreakdown(current.storedBreakdown, sanitizeBreakdownByInbox(storedBreakdownRaw, inboxId));
      } else {
        const storedBucket = enforceOwnerBucketByInbox(state.responsibleBucket || "ia", inboxId) as ResponsibleBucket;
        const storedCount = Number(state.responsibleMessageCount || 0);
        if (storedCount > 0) {
          current.storedBreakdown[storedBucket] += storedCount;
        }
      }

      mergedStates.set(phonePk, current);
    }

    const trackedConversationIds = Array.from(
      new Set(
        Array.from(mergedStates.values()).flatMap((item) => Array.from(item.conversationIds.values())),
      ),
    );

    const conversationResponsibleMap = new Map<number, ConversationResponsibleSnapshot>();
    const conversationMetaMap = new Map<number, { accountId: number | null; inboxId: number | null }>();

    if (trackedConversationIds.length > 0) {
      const [messageRows, conversationRows] = await Promise.all([
        prisma.message.findMany({
          where: {
            tenantId: latestRun.tenantId,
            conversation: {
              chatwootConversationId: {
                in: trackedConversationIds,
              },
            },
            role: {
              contains: "AGENT",
              mode: "insensitive",
            },
          },
          select: {
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
        }),
        prisma.conversation.findMany({
          where: {
            tenantId: latestRun.tenantId,
            chatwootConversationId: {
              in: trackedConversationIds,
            },
          },
          select: {
            chatwootConversationId: true,
            channel: {
              select: {
                chatwootAccountId: true,
                chatwootInboxId: true,
              },
            },
          },
        }),
      ]);

      for (const row of conversationRows) {
        const conversationId = Number(row.chatwootConversationId || 0);
        if (!conversationId) continue;
        conversationMetaMap.set(conversationId, {
          accountId: Number(row.channel?.chatwootAccountId || 0) || null,
          inboxId: Number(row.channel?.chatwootInboxId || 0) || null,
        });
      }

      for (const row of messageRows) {
        const conversationId = Number(row.conversation?.chatwootConversationId || 0);
        if (!conversationId) continue;
        const inboxId = Number(row.conversation?.channel?.chatwootInboxId || 0) || null;
        const bucket = resolveResponsibleBucket(row.senderName, inboxId);
        if (!bucket) continue;
        const current = conversationResponsibleMap.get(conversationId) || {
          counts: createEmptyBreakdown(),
          last: null,
        };
        current.counts[bucket] += 1;
        current.last = { bucket, at: row.createdAt.getTime() };
        conversationResponsibleMap.set(conversationId, current);
      }
    }

    const buildResponsibleTracking = (conversationIds: number[]) => {
      const counts = createEmptyBreakdown();
      let latestBucket: ResponsibleBucket | null = null;
      let latestAt = 0;

      for (const rawConversationId of conversationIds) {
        const conversationId = Number(rawConversationId || 0);
        if (!conversationId) continue;
        const snapshot = conversationResponsibleMap.get(conversationId);
        if (!snapshot) continue;
        addBreakdown(counts, snapshot.counts);
        if (snapshot.last && snapshot.last.at > latestAt) {
          latestAt = snapshot.last.at;
          latestBucket = snapshot.last.bucket;
        }
      }

      const bucket = pickResponsibleBucketFromBreakdown(counts, latestBucket);
      return {
        bucket,
        label: responsibleLabel(bucket),
        messageCount: counts[bucket] || 0,
        breakdown: counts,
      };
    };

    const phoneKeys = Array.from(mergedStates.keys());
    const timelineRows =
      phoneKeys.length > 0
        ? await prisma.conversationTimelineEvent.findMany({
            where: {
              tenantId: latestRun.tenantId,
              phonePk: { in: phoneKeys },
            },
            orderBy: [{ createdAt: "asc" }],
            select: {
              phonePk: true,
              dateRef: true,
              chatwootConversationId: true,
              eventType: true,
              severity: true,
              reason: true,
              source: true,
              createdAt: true,
            },
          })
        : [];

    const timelineByPhone = new Map<string, ClientRecordItem["timeline"]>();
    for (const row of timelineRows) {
      const key = String(row.phonePk || "").trim();
      if (!key) continue;
      if (!timelineByPhone.has(key)) timelineByPhone.set(key, []);
      timelineByPhone.get(key)?.push({
        dateRef: row.dateRef.toISOString().slice(0, 10),
        conversationId: Number(row.chatwootConversationId || 0),
        eventType: String(row.eventType || ""),
        severity: normalizeSeverity(row.severity),
        reason: String(row.reason || ""),
        source: String(row.source || ""),
        createdAt: row.createdAt.toISOString(),
      });
    }

    const items: ClientRecordItem[] = Array.from(mergedStates.values())
      .map((state) => {
        const labels = Array.from(state.labels.values());
        const conversationIds = Array.from(state.conversationIds.values()).sort((a, b) => a - b);
        const storedTracking =
          sumBreakdown(state.storedBreakdown) > 0
            ? {
                bucket: pickResponsibleBucketFromBreakdown(state.storedBreakdown, null),
                label: "",
                messageCount: 0,
                breakdown: state.storedBreakdown,
              }
            : null;
        const responsibleTracking = storedTracking
          ? {
              bucket: storedTracking.bucket,
              label: responsibleLabel(storedTracking.bucket),
              messageCount: storedTracking.breakdown[storedTracking.bucket] || 0,
              breakdown: storedTracking.breakdown,
            }
          : buildResponsibleTracking(conversationIds);

        const chatLinks = conversationIds
          .map((conversationId) => {
            const meta = conversationMetaMap.get(conversationId);
            const accountId = Number(meta?.accountId || 0);
            const inboxId = Number(meta?.inboxId || 0);
            if (accountId <= 0 || inboxId <= 0 || conversationId <= 0) return null;
            return `https://chat.iainfinity.com.br/app/accounts/${accountId}/inbox/${inboxId}/conversations/${conversationId}`;
          })
          .filter((item): item is string => Boolean(item));

        const phase = deriveClientPhase(state.companyName, state.cnpj);
        const pipelineState = derivePipelineState({
          labels,
          currentStatus: state.latestStatus,
          currentSeverity: state.highestSeverity,
        });

        return {
          phonePk: state.phonePk,
          contactName: toTitleCaseName(state.contactName || "Contato"),
          companyName: state.companyName,
          cnpj: state.cnpj,
          gaps: [],
          attentions: [],
          labels,
          products: [],
          conversationIds,
          chatLinks,
          openedAt: state.firstSeenAt?.toISOString() || null,
          closedAt: state.resolvedAt?.toISOString() || null,
          status: pipelineState.status,
          severity: state.highestSeverity,
          responsibleBucket: responsibleTracking.bucket,
          responsibleLabel: responsibleTracking.label,
          responsibleMessageCount: responsibleTracking.messageCount,
          responsibleMessageBreakdown: responsibleTracking.breakdown,
          clientPhase: phase.phase,
          clientPhaseReason: phase.reason,
          finalizationActor: null,
          pipelineBlock: pipelineState.pipelineBlock,
          remarketing: pipelineState.remarketing,
          lifecycle: {
            firstSeenAt: state.firstSeenAt?.toISOString() || "",
            lastSeenAt: state.lastSeenAt?.toISOString() || "",
            firstIssueAt: state.firstIssueAt ? state.firstIssueAt.toISOString() : null,
            lastIssueAt: state.lastIssueAt ? state.lastIssueAt.toISOString() : null,
            resolvedAt: state.resolvedAt ? state.resolvedAt.toISOString() : null,
            currentStatus: normalizeStatus(state.latestStatus),
            currentSeverity: state.highestSeverity,
          },
          timeline: timelineByPhone.get(state.phonePk) || [],
        } satisfies ClientRecordItem;
      })
      .filter((item) => ownerScope === "all" || String(item.responsibleBucket || "ia") === ownerScope);

    return NextResponse.json({
      date: "overall",
      owner_scope: ownerScope,
      runId: latestRun.id,
      generatedAt: latestRun.startedAt.toISOString(),
      source: "client_states_overall",
      items,
    });
  } catch (error: unknown) {
    const message = sanitizeClientErrorMessage(error, "Nao foi possivel carregar os clientes gerais.");
    return NextResponse.json({ error: "clients_overall_fetch_failed", message }, { status: 400 });
  }
}
