import { createHash } from "node:crypto";
import { GapSeverity, InsightSeverity, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { AppConfig } from "../types";
import type { ReportPayload } from "@/types";

export type DbClient = Prisma.TransactionClient | typeof prisma;

export function normalizeSlug(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function toDateRef(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function toChatwootAppBase(baseUrl: string): string {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    const cleanedPath = parsed.pathname
      .replace(/\/+$/, "")
      .replace(/\/api\/v1(?:\/.*)?$/i, "")
      .replace(/\/api(?:\/.*)?$/i, "");
    return `${parsed.origin}${cleanedPath}`.replace(/\/+$/, "");
  } catch {
    return raw
      .replace(/\/+$/, "")
      .replace(/\/api\/v1(?:\/.*)?$/i, "")
      .replace(/\/api(?:\/.*)?$/i, "");
  }
}

export function buildConversationLink(baseUrl: string, accountId: number, inboxId: number, conversationId: number): string | null {
  if (!baseUrl || !accountId || !inboxId || !conversationId) return null;
  return `${baseUrl}/app/accounts/${accountId}/inbox/${inboxId}/conversations/${conversationId}`;
}

export function parseGapSeverity(value: unknown): GapSeverity {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.startsWith("alt")) return GapSeverity.alta;
  if (raw.startsWith("med")) return GapSeverity.media;
  if (raw.startsWith("baix")) return GapSeverity.baixa;
  return GapSeverity.nao_informado;
}

export function parseInsightSeverity(value: unknown): InsightSeverity {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "critical") return InsightSeverity.critical;
  if (raw === "high") return InsightSeverity.high;
  if (raw === "medium") return InsightSeverity.medium;
  if (raw === "low") return InsightSeverity.low;
  return InsightSeverity.info;
}

export function parseJsonSafe(text: unknown): Record<string, unknown> {
  const raw = String(text || "").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const fencedMatch = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    if (!fencedMatch) return {};
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
      return {};
    }
  }
}

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

export function parseGapEntries(parsed: Record<string, unknown>): Array<Record<string, unknown>> {
  const items = parsed.gaps_operacionais;
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
}

export function pickFirstText(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

export function asBool(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1" || text === "sim") return true;
  if (text === "false" || text === "0" || text === "nao" || text === "não") return false;
  return null;
}

export function asNumOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeIdentifier(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  return digits || raw.toLowerCase();
}

function getIdentifierHash(identifier: string): string | null {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return null;
  const salt = process.env.PII_HASH_SALT || process.env.DATABASE_URL || "hile-default-salt";
  return createHash("sha256").update(`${salt}:${normalized}`).digest("hex");
}

export async function resolveTenantAndChannel(db: DbClient, config: AppConfig, report: ReportPayload) {
  const accountId = Number(report.account?.id || config.chatwoot.accountId || 0);
  const inboxId = Number(report.inbox?.id || config.chatwoot.inboxId || 0);
  const groupName = String(report.account?.name || config.chatwoot.groupName || "Tenant");
  const inboxName = String(report.inbox?.name || config.chatwoot.inboxName || "Inbox");
  const slugBase = normalizeSlug(`${groupName}-${accountId || "na"}`) || "tenant";

  const tenant = await db.tenant.upsert({
    where: { slug: slugBase },
    update: { name: groupName },
    create: { slug: slugBase, name: groupName },
  });

  const channel = await db.channel.upsert({
    where: {
      tenantId_chatwootAccountId_chatwootInboxId: {
        tenantId: tenant.id,
        chatwootAccountId: accountId,
        chatwootInboxId: inboxId,
      },
    },
    update: {
      name: inboxName,
      provider: report.inbox?.provider || config.chatwoot.inboxProvider || null,
    },
    create: {
      tenantId: tenant.id,
      chatwootAccountId: accountId,
      chatwootInboxId: inboxId,
      name: inboxName,
      provider: report.inbox?.provider || config.chatwoot.inboxProvider || null,
    },
  });

  return { tenant, channel };
}

export async function upsertContactByReference(params: {
  db: DbClient;
  tenantId: string;
  contactKey: string;
  contactName: string;
  contactIdentifier: string;
}) {
  const { db, tenantId, contactKey, contactName, contactIdentifier } = params;
  const chatwootContactId = Number.isFinite(Number(contactKey)) ? Number(contactKey) : null;
  const identifierHash = getIdentifierHash(contactIdentifier);
  const identifierLast4 = contactIdentifier ? contactIdentifier.slice(-4) : null;

  let existing =
    chatwootContactId !== null
      ? await db.contact.findFirst({
          where: {
            tenantId,
            chatwootContactId,
          },
        })
      : null;

  if (!existing && identifierHash) {
    existing = await db.contact.findFirst({
      where: {
        tenantId,
        identifierHash,
      },
    });
  }

  if (existing) {
    return db.contact.update({
      where: { id: existing.id },
      data: {
        name: contactName || existing.name || null,
        chatwootContactId: existing.chatwootContactId ?? chatwootContactId,
        identifierHash: existing.identifierHash || identifierHash,
        identifierLast4: existing.identifierLast4 || identifierLast4,
      },
    });
  }

  try {
    return await db.contact.create({
      data: {
        tenantId,
        chatwootContactId,
        name: contactName || null,
        identifierHash,
        identifierLast4,
      },
    });
  } catch (error: unknown) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "P2002") throw error;

    const fallback =
      (chatwootContactId !== null
        ? await db.contact.findFirst({
            where: { tenantId, chatwootContactId },
          })
        : null) ||
      (identifierHash
        ? await db.contact.findFirst({
            where: { tenantId, identifierHash },
          })
        : null);

    if (!fallback) throw error;

    return db.contact.update({
      where: { id: fallback.id },
      data: {
        name: contactName || fallback.name || null,
        chatwootContactId: fallback.chatwootContactId ?? chatwootContactId,
        identifierHash: fallback.identifierHash || identifierHash,
        identifierLast4: fallback.identifierLast4 || identifierLast4,
      },
    });
  }
}

export function allInsightsFromAnalysis(analysis: ReportPayload["raw_analysis"]["analyses"][number]) {
  const items = analysis.conversation_operational || [];
  return items
    .map((item) => item.state)
    .filter(Boolean)
    .map((state) => {
      if (state?.finalization_status === "finalizada") {
        return {
          type: "finalization",
          severity: "low",
          title: "Conversa finalizada",
          summary: state.finalization_actor
            ? `Finalizada por ${state.finalization_actor}.`
            : "Conversa encerrada com status de finalização.",
          state,
        };
      }
      if (state?.waiting_on_agent) {
        return {
          type: "pending_agent",
          severity: "medium",
          title: "Aguardando resposta do atendimento",
          summary: "Cliente aguardando resposta.",
          state,
        };
      }
      return {
        type: "pending_customer",
        severity: "info",
        title: "Aguardando retorno do cliente",
        summary: "Última interação foi enviada pela IA/atendente.",
        state,
      };
    });
}
