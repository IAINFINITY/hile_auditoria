import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { ClientRecordItem, Severity } from "@/types";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";
import { enforceOwnerBucketByInbox, sanitizeBreakdownByInbox } from "@/lib/server/audit/ownerBuckets";

export const runtime = "nodejs";

type OwnerScope = "all" | "ia" | "suellen" | "samuel";
type ResponsibleBucket = "ia" | "suellen" | "samuel";

function normalizeOwnerScope(value: string | null): OwnerScope {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ia" || normalized === "suellen" || normalized === "samuel") return normalized;
  return "all";
}

function normalizeLabelText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function resolveResponsibleBucket(senderName: unknown, inboxId: unknown): ResponsibleBucket | null {
  const normalized = normalizeLabelText(senderName);
  if (!normalized) return "ia";
  if (/\b(grupo|group|equipe|team|channel)\b/.test(normalized)) return null;
  if (/\bsamuel\b/.test(normalized)) return enforceOwnerBucketByInbox("samuel", inboxId);
  if (/\bsuelen\b|\bsuellen\b/.test(normalized)) return enforceOwnerBucketByInbox("suellen", inboxId);
  if (/\bacesso infinity\b|\bassistant\b|\bbot\b|(^|\s)ia(\s|$)/.test(normalized)) return enforceOwnerBucketByInbox("ia", inboxId);
  return enforceOwnerBucketByInbox("ia", inboxId);
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

function hasExitLabel(labels: string[]): boolean {
  const normalized = (labels || []).map((item) =>
    String(item || "")
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""),
  );
  return normalized.includes("lead_agendado") || normalized.includes("pausar_ia");
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
        channelId: true,
        startedAt: true,
        channel: {
          select: {
            chatwootAccountId: true,
            chatwootInboxId: true,
          },
        },
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
        channelId: latestRun.channelId,
        ...(lastSeenWhere.gte || lastSeenWhere.lte ? { lastSeenAt: lastSeenWhere } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        phonePk: true,
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
      },
    });

    const trackedConversationIds = Array.from(
      new Set(
        states.flatMap((item) =>
          Array.isArray(item.openConversationIds)
            ? item.openConversationIds.map((id) => Number(id || 0)).filter((id) => id > 0)
            : [],
        ),
      ),
    );

    const conversationResponsibleMap = new Map<
      number,
      {
        counts: { ia: number; suellen: number; samuel: number };
        last: { bucket: ResponsibleBucket; at: number } | null;
      }
    >();

    if (trackedConversationIds.length > 0) {
      const rows = await prisma.message.findMany({
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
      });

      for (const row of rows) {
        const conversationId = Number(row.conversation?.chatwootConversationId || 0);
        if (!conversationId) continue;
        const inboxId = Number(row.conversation?.channel?.chatwootInboxId || 0) || null;
        const bucket = resolveResponsibleBucket(row.senderName, inboxId);
        if (!bucket) continue;
        const current = conversationResponsibleMap.get(conversationId) || {
          counts: { ia: 0, suellen: 0, samuel: 0 },
          last: null,
        };
        current.counts[bucket] += 1;
        current.last = { bucket, at: row.createdAt.getTime() };
        conversationResponsibleMap.set(conversationId, current);
      }
    }

    const buildResponsibleTracking = (conversationIds: number[]) => {
      const counts = { ia: 0, suellen: 0, samuel: 0 };
      let latest: { bucket: ResponsibleBucket; at: number } | null = null;

      for (const rawId of conversationIds || []) {
        const id = Number(rawId || 0);
        if (!id) continue;
        const entry = conversationResponsibleMap.get(id);
        if (!entry) continue;
        counts.ia += Number(entry.counts.ia || 0);
        counts.suellen += Number(entry.counts.suellen || 0);
        counts.samuel += Number(entry.counts.samuel || 0);
        if (entry.last && (!latest || entry.last.at > latest.at)) latest = { ...entry.last };
      }

      const ranked = (Object.entries(counts) as Array<[ResponsibleBucket, number]>).sort((a, b) => b[1] - a[1]);
      const bucket: ResponsibleBucket = latest?.bucket || (ranked[0]?.[1] > 0 ? ranked[0][0] : "ia");
      return {
        bucket,
        label: responsibleLabel(bucket),
        messageCount: counts[bucket] || 0,
        breakdown: counts,
      };
    };

    const phoneKeys = states.map((item) => item.phonePk).filter(Boolean);
    const timelineRows =
      phoneKeys.length > 0
        ? await prisma.conversationTimelineEvent.findMany({
            where: {
              tenantId: latestRun.tenantId,
              channelId: latestRun.channelId,
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

    const items: ClientRecordItem[] = states
      .map((state) => {
      const labels = Array.isArray(state.currentLabels) ? state.currentLabels : [];
      const conversationIds = Array.isArray(state.openConversationIds)
        ? state.openConversationIds.map((id) => Number(id || 0)).filter((id) => id > 0)
        : [];
      const storedBreakdownRaw =
        state.responsibleMessageBreakdown && typeof state.responsibleMessageBreakdown === "object"
          ? (state.responsibleMessageBreakdown as Record<string, unknown>)
          : null;
      const storedBreakdown = storedBreakdownRaw
        ? sanitizeBreakdownByInbox(storedBreakdownRaw, latestRun.channel?.chatwootInboxId || null)
        : null;
      const hasStoredBreakdown =
        Boolean(storedBreakdown) &&
        ((storedBreakdown?.ia || 0) > 0 || (storedBreakdown?.suellen || 0) > 0 || (storedBreakdown?.samuel || 0) > 0);
      const storedBucketRaw = String(state.responsibleBucket || "ia").trim().toLowerCase();
      const storedBucket = enforceOwnerBucketByInbox(
        storedBucketRaw === "suellen" || storedBucketRaw === "samuel" ? storedBucketRaw : "ia",
        latestRun.channel?.chatwootInboxId || null,
      ) as ResponsibleBucket;
      const responsibleTracking = hasStoredBreakdown
        ? {
            bucket: storedBucket,
            label: String(state.responsibleLabel || "").trim() || responsibleLabel(storedBucket),
            messageCount: Number(state.responsibleMessageCount || 0) || 0,
            breakdown: storedBreakdown as { ia: number; suellen: number; samuel: number },
          }
        : buildResponsibleTracking(conversationIds);

      const chatLinks = conversationIds
        .map((conversationId) => {
          const accountId = Number(latestRun.channel?.chatwootAccountId || 0);
          const inboxId = Number(latestRun.channel?.chatwootInboxId || 0);
          if (accountId <= 0 || inboxId <= 0 || conversationId <= 0) return null;
          return `https://chat.iainfinity.com.br/app/accounts/${accountId}/inbox/${inboxId}/conversations/${conversationId}`;
        })
        .filter((item): item is string => Boolean(item));

      return {
        phonePk: state.phonePk,
        contactName: toTitleCaseName(state.contactName || "Contato"),
        companyName: String(state.companyName || ""),
        cnpj: String(state.cnpj || ""),
        gaps: [],
        attentions: [],
        labels,
        products: [],
        conversationIds,
        chatLinks,
        openedAt: state.firstSeenAt?.toISOString() || null,
        closedAt: state.resolvedAt?.toISOString() || null,
        status: hasExitLabel(labels) ? "resolvido" : normalizeStatus(state.currentStatus),
        severity: normalizeSeverity(state.currentSeverity),
        responsibleBucket: responsibleTracking.bucket,
        responsibleLabel: responsibleTracking.label,
        responsibleMessageCount: responsibleTracking.messageCount,
        responsibleMessageBreakdown: responsibleTracking.breakdown,
        clientPhase: "inicial" as const,
        clientPhaseReason: "Classificação geral baseada no estado atual consolidado.",
        finalizationActor: null,
        pipelineBlock: hasExitLabel(labels)
          ? "resolvido"
          : normalizeSeverity(state.currentSeverity) === "critical" ||
              normalizeSeverity(state.currentSeverity) === "high"
            ? "atencao"
            : "entrada",
        remarketing: null,
        lifecycle: {
          firstSeenAt: state.firstSeenAt.toISOString(),
          lastSeenAt: state.lastSeenAt.toISOString(),
          firstIssueAt: state.firstIssueAt ? state.firstIssueAt.toISOString() : null,
          lastIssueAt: state.lastIssueAt ? state.lastIssueAt.toISOString() : null,
          resolvedAt: state.resolvedAt ? state.resolvedAt.toISOString() : null,
          currentStatus: normalizeStatus(state.currentStatus),
          currentSeverity: normalizeSeverity(state.currentSeverity),
        },
        timeline: timelineByPhone.get(state.phonePk) || [],
      };
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
    const message = error instanceof Error ? error.message : "Não foi possível carregar os clientes gerais.";
    return NextResponse.json({ error: "clients_overall_fetch_failed", message }, { status: 400 });
  }
}
