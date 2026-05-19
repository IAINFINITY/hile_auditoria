import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { ClientRecordItem, Severity } from "@/types";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

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
      },
    });

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

    const items: ClientRecordItem[] = states.map((state) => {
      const labels = Array.isArray(state.currentLabels) ? state.currentLabels : [];
      const conversationIds = Array.isArray(state.openConversationIds)
        ? state.openConversationIds.map((id) => Number(id || 0)).filter((id) => id > 0)
        : [];

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
        responsibleBucket: "ia",
        responsibleLabel: "IA",
        responsibleMessageCount: null,
        responsibleMessageBreakdown: null,
        clientPhase: "inicial",
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
    });

    return NextResponse.json({
      date: "overall",
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
