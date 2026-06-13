import { Prisma, RunStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { AppConfig } from "./types";
import type { ReportPayload } from "@/types";
import { buildClientRecordsFromAnalyses } from "./clientRecords";
import { toTitleCaseName } from "./nameFormat";
import {
  enforceOwnerBucketByInbox,
  resolveResponsibleBucketBySenderName,
  sanitizeBreakdownByInbox,
} from "./ownerBuckets";
import {
  allInsightsFromAnalysis,
  asBool,
  asNumOrNull,
  asRecord,
  asStringList,
  buildConversationLink,
  parseGapEntries,
  parseGapSeverity,
  parseInsightSeverity,
  parseJsonSafe,
  pickFirstText,
  resolveTenantAndChannel,
  toChatwootAppBase,
  toDateRef,
  toJsonValue,
  upsertContactByReference,
} from "./persistence/helpers";

const insightSeverityRank: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

type AuditReadCacheEntry<T> = {
  expiresAt: number;
  value: T;
};

declare global {
  // Short-lived in-memory cache to soften repeated dashboard reads.
  // Safe to lose between instances.
  var __hileAuditReadCache: Map<string, AuditReadCacheEntry<unknown>> | undefined;
}

function getAuditReadCache(): Map<string, AuditReadCacheEntry<unknown>> {
  if (!globalThis.__hileAuditReadCache) {
    globalThis.__hileAuditReadCache = new Map<string, AuditReadCacheEntry<unknown>>();
  }
  return globalThis.__hileAuditReadCache;
}

function readAuditCache<T>(key: string): T | null {
  const entry = getAuditReadCache().get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    getAuditReadCache().delete(key);
    return null;
  }
  return entry.value as T;
}

function writeAuditCache<T>(key: string, value: T, ttlMs = 10_000): T {
  getAuditReadCache().set(key, {
    value,
    expiresAt: Date.now() + Math.max(1_000, ttlMs),
  });
  return value;
}

export function invalidateAuditReadCache(): void {
  getAuditReadCache().clear();
}

function normalizeTimelineStatus(value: unknown): string {
  const v = String(value || "").toLowerCase();
  if (v === "resolvido") return "resolvido";
  if (v === "atencao") return "atencao";
  return "aberto";
}

function pickTimelineEventType(params: {
  previousStatus: string | null;
  nextStatus: string;
  movedOutOfAi: boolean;
}): "issue_opened" | "issue_updated" | "issue_resolved" | "moved_out_of_ai" {
  if (params.movedOutOfAi) return "moved_out_of_ai";
  if (params.nextStatus === "resolvido") return "issue_resolved";
  if (!params.previousStatus || params.previousStatus === "resolvido") return "issue_opened";
  return "issue_updated";
}

function isSystemAssignmentReason(value: unknown): boolean {
  const normalized = String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!normalized) return false;
  return (
    /conversa\s+foi\s+atribuida\s+a/.test(normalized) ||
    /conversa\s+atribuida\s+a/.test(normalized) ||
    /\batribuida\b/.test(normalized) ||
    /\batribuido\b/.test(normalized) ||
    /\bassigned\b/.test(normalized)
  );
}

function pickTimelineReason(params: {
  gaps: string[];
  attentions: string[];
  movedOutOfAi: boolean;
  fallback: string;
}): string {
  const candidates = [...(params.gaps || []), ...(params.attentions || [])];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    if (isSystemAssignmentReason(text)) continue;
    return text;
  }
  if (params.movedOutOfAi) return "Conversa saiu do fluxo da IA por etiqueta operacional.";
  return params.fallback;
}

function hasRenderableReportData(reportJson: Record<string, unknown> | null | undefined): boolean {
  if (!reportJson || typeof reportJson !== "object") return false;
  const rawAnalysis = (reportJson.raw_analysis || {}) as Record<string, unknown>;
  const analyses = Array.isArray(rawAnalysis.analyses) ? rawAnalysis.analyses : [];
  const failures = Array.isArray(rawAnalysis.failures) ? rawAnalysis.failures : [];
  const logs = Array.isArray(reportJson.logs) ? reportJson.logs : [];
  const logsCount = Number(reportJson.logs_count || 0);
  return analyses.length > 0 || failures.length > 0 || logs.length > 0 || logsCount > 0;
}

function normalizeSeverityLabel(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeClientProductName(value: unknown): string {
  const clean = String(value || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

function normalizeClientProductList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<string>();
  for (const value of values) {
    const normalized = normalizeClientProductName(value);
    if (normalized) out.add(normalized);
  }
  return Array.from(out);
}

function normalizePhaseText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function mapExplicitClientPhase(value: unknown): "inicial" | "intermediario" | "avancado" | null {
  const normalized = normalizePhaseText(value);
  if (!normalized) return null;
  if (normalized.includes("avanc")) return "avancado";
  if (normalized.includes("intermedi")) return "intermediario";
  if (normalized.includes("inicial")) return "inicial";
  return null;
}

function deriveClientPhaseFromSignals(params: {
  explicitPhase?: unknown;
  explicitReason?: unknown;
  cnpj?: unknown;
  companyName?: unknown;
  products?: unknown;
  labels?: unknown;
  textSignals?: Array<unknown>;
}): { phase: "inicial" | "intermediario" | "avancado"; reason: string } {
  const explicit = mapExplicitClientPhase(params.explicitPhase);
  const explicitReason = String(params.explicitReason || "").trim();
  if (explicit) {
    return {
      phase: explicit,
      reason: explicitReason || "Classificação informada diretamente pela análise da IA.",
    };
  }

  const cnpjDigits = String(params.cnpj || "").replace(/\D+/g, "");
  const hasCnpj = cnpjDigits.length >= 14;
  const hasCompany = String(params.companyName || "").trim().length > 0;
  const products = Array.isArray(params.products) ? params.products.map((item) => String(item || "").trim()).filter(Boolean) : [];
  const labels = Array.isArray(params.labels) ? params.labels.map((item) => normalizePhaseText(item)) : [];
  const textSignals = (params.textSignals || [])
    .map((item) => normalizePhaseText(item))
    .filter(Boolean)
    .join(" ");
  const productSignals = normalizePhaseText(products.join(" "));
  const labelsSignals = labels.join(" ");
  const corpus = `${textSignals} ${productSignals} ${labelsSignals}`.trim();

  const hasBrandSignals =
    /\b(instagram|site|loja|e-?commerce|marketplace|marca propria|marca propria|minha marca)\b/.test(corpus);
  const hasInitialSignals =
    /\b(nao tenho cnpj|sem cnpj|so tenho a ideia|apenas ideia|estou comecando|nunca terceiriz|primeira marca)\b/.test(
      corpus,
    );
  const hasAdvancedSignals =
    /\b(ja tenho marca|marca rodando|empresa rodando|ja terceiriz|otimizar producao|aumentar escala|fornecedor atual|fabricante atual)\b/.test(
      corpus,
    );

  if (hasAdvancedSignals && (hasCnpj || hasCompany || hasBrandSignals)) {
    return {
      phase: "avancado",
      reason: "Cliente já opera marca/empresa e busca otimizar a terceirização da produção.",
    };
  }

  if (hasCnpj || hasCompany || hasBrandSignals) {
    return {
      phase: "intermediario",
      reason: "Cliente já possui estrutura inicial de marca/empresa (CNPJ, presença digital ou operação em andamento).",
    };
  }

  if (hasInitialSignals) {
    return {
      phase: "inicial",
      reason: "Cliente ainda está em fase de ideia inicial e sem estrutura formal consolidada.",
    };
  }

  return {
    phase: "inicial",
    reason: "Sem evidências de estrutura formal ativa; classificado como fase inicial por padrão.",
  };
}

function isCriticalSeverityLabel(value: unknown): boolean {
  const normalized = normalizeSeverityLabel(value);
  return normalized.startsWith("crit") || normalized === "critical";
}

function deriveRiskLevelFromParsed(parsed: Record<string, unknown>): "critical" | "non_critical" {
  const topLevel = parsed.severidade || parsed.severity || parsed.nivel_risco || parsed.risco;
  if (isCriticalSeverityLabel(topLevel)) return "critical";

  const gaps = parseGapEntries(parsed);
  for (const gap of gaps) {
    const severityLabel = pickFirstText(gap, ["severidade", "severity", "nivel", "prioridade", "priority"]);
    if (isCriticalSeverityLabel(severityLabel)) return "critical";
  }

  return "non_critical";
}

function firstNonEmptyStringArray(
  ...candidates: Array<string[] | null | undefined>
): string[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  return [];
}

type ParsedOperationalMessage = {
  role: "USER" | "AGENT";
  content: string;
  timestamp: Date | null;
};

function parseOperationalMessages(logText: string): ParsedOperationalMessage[] {
  const lines = String(logText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const messages: ParsedOperationalMessage[] = [];
  for (const line of lines) {
    const match = line.match(
      /^\[(.*?)\]\s*(?:\[[^\]]+\]\s*)?([A-Z_\u00C0-\u00FF ]+?)(?:\s*\([^)]+\))?\s*[:\-]\s*(.*)$/i,
    );
    if (!match) continue;
    const roleRaw = String(match[2] || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (!/(user|usuario|cliente|agent|assistant|acesso infinity|acesso_infinity|atendente|bot|ia)/.test(roleRaw)) {
      continue;
    }
    const role: "USER" | "AGENT" =
      /(user|usuario|cliente)/.test(roleRaw) ? "USER" : "AGENT";
    const timestampRaw = String(match[1] || "");
    const timestamp = new Date(timestampRaw);
    messages.push({
      role,
      content: String(match[3] || "").trim(),
      timestamp: Number.isNaN(timestamp.getTime()) ? null : timestamp,
    });
  }
  return messages;
}

function deriveFallbackMetricsAndProducts(
  parsed: Record<string, unknown>,
  logText: string,
): Record<string, unknown> {
  const next = { ...parsed } as Record<string, unknown>;

  if (!next.metricas_cliente || typeof next.metricas_cliente !== "object") {
    const messages = parseOperationalMessages(logText);
    let waitingSince: Date | null = null;
    const delays: number[] = [];
    const userHours = new Array<number>(24).fill(0);
    let totalUser = 0;

    for (const msg of messages) {
      if (msg.role === "AGENT" && msg.timestamp) {
        waitingSince = msg.timestamp;
        continue;
      }
      if (msg.role === "USER" && msg.timestamp) {
        totalUser += 1;
        userHours[msg.timestamp.getHours()] += 1;
        if (waitingSince) {
          const delta = Math.floor((msg.timestamp.getTime() - waitingSince.getTime()) / 1000);
          if (delta >= 0) delays.push(delta);
          waitingSince = null;
        }
      }
    }

    let peakHour = -1;
    let peakCount = 0;
    for (let i = 0; i < userHours.length; i += 1) {
      if (userHours[i] > peakCount) {
        peakCount = userHours[i];
        peakHour = i;
      }
    }

    const avgSeconds =
      delays.length > 0 ? Math.round(delays.reduce((acc, current) => acc + current, 0) / delays.length) : null;
    next.metricas_cliente = {
      tempo_medio_resposta_seg: avgSeconds,
      hora_pico_resposta: peakHour >= 0 ? `${String(peakHour).padStart(2, "0")}h` : null,
      amostragem_respostas: delays.length > 0 ? delays.length : null,
      total_mensagens: totalUser > 0 ? totalUser : null,
    };
  }

  if (!Array.isArray(next.produtos_citados) || next.produtos_citados.length === 0) {
    const aliases: Array<{ name: string; terms: string[] }> = [
      { name: "whey_protein", terms: ["whey", "wei", "wehy", "whey protein"] },
      { name: "creatina", terms: ["creatina", "creatine"] },
      { name: "pre_treino", terms: ["pre treino", "pre-treino", "pretreino", "pre workout", "pre-workout"] },
      { name: "colageno", terms: ["colageno", "colágeno", "collagen"] },
    ];
    const userText = parseOperationalMessages(logText)
      .filter((msg) => msg.role === "USER")
      .map((msg) =>
        String(msg.content || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, ""),
      )
      .join(" ");

    const products = aliases
      .filter((entry) =>
        entry.terms.some((term) =>
          userText.includes(
            term
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, ""),
          ),
        ),
      )
      .map((entry) => ({
        nome_produto: entry.name,
        termo_detectado: entry.terms[0],
      }));

    next.produtos_citados = products;
  }

  return next;
}

export async function createRunRecord(params: {
  config: AppConfig;
  date: string;
  startedAtIso: string;
  account?: { id: number; name: string | null };
  inbox?: { id: number; name: string | null; provider: string | null };
}) {
  const staleMinutesRaw = Number(process.env.ANALYSIS_RUNNING_STALE_MINUTES || 30);
  const staleMinutes = Number.isFinite(staleMinutesRaw)
    ? Math.min(240, Math.max(5, Math.floor(staleMinutesRaw)))
    : 30;
  const baseReportLike = {
    account: params.account || { id: params.config.chatwoot.accountId || 0, name: params.config.chatwoot.groupName },
    inbox: params.inbox || {
      id: params.config.chatwoot.inboxId || 0,
      name: params.config.chatwoot.inboxName,
      provider: params.config.chatwoot.inboxProvider,
    },
  } as ReportPayload;

  return prisma.$transaction(async (tx) => {
    const { tenant, channel } = await resolveTenantAndChannel(tx, params.config, baseReportLike);
    const dateRef = toDateRef(params.date);
    const lockKey = `analysis-run:${tenant.id}:${channel.id}:${params.date}`;

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
    const now = new Date(params.startedAtIso);

    await tx.analysisRun.updateMany({
      where: {
        tenantId: tenant.id,
        channelId: channel.id,
        dateRef,
        status: RunStatus.running,
        startedAt: { lt: staleBefore },
      },
      data: {
        status: RunStatus.failed,
        finishedAt: now,
      },
    });

    const activeRun = await tx.analysisRun.findFirst({
      where: {
        tenantId: tenant.id,
        channelId: channel.id,
        dateRef,
        status: RunStatus.running,
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        startedAt: true,
        events: {
          select: { createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (activeRun?.id) {
      const lastHeartbeat = activeRun.events?.[0]?.createdAt || activeRun.startedAt;
      if (lastHeartbeat < staleBefore) {
        await tx.analysisRun.update({
          where: { id: activeRun.id },
          data: {
            status: RunStatus.failed,
            finishedAt: now,
          },
        });
        await tx.jobEvent.create({
          data: {
            runId: activeRun.id,
            eventType: "run_failed_stale",
            payloadJson: {
              message: `Execução marcada como stale após ${staleMinutes} min sem heartbeat.`,
              stale_minutes: staleMinutes,
              stale_before: staleBefore.toISOString(),
            },
          },
        });
      } else {
        const error = new Error("Já existe uma execução em andamento para essa data e canal.");
        (error as Error & { code?: string }).code = "RUN_ALREADY_IN_PROGRESS";
        throw error;
      }
    }

    const run = await tx.analysisRun.create({
      data: {
        tenantId: tenant.id,
        channelId: channel.id,
        dateRef,
        status: RunStatus.running,
        startedAt: now,
      },
      select: { id: true },
    });

    invalidateAuditReadCache();
    return run.id;
  }, { maxWait: 20_000, timeout: 120_000 });
}

export async function getCachedAnalysisByFingerprint(params: {
  config: AppConfig;
  account: { id: number; name: string | null };
  inbox: { id: number; name: string | null; provider: string | null };
  conversationIds: number[];
  sourceFingerprint: string;
}): Promise<{ answer: string } | null> {
  const fingerprint = String(params.sourceFingerprint || "").trim();
  const ids = (params.conversationIds || []).map((id) => Number(id || 0)).filter((id) => id > 0);
  if (!fingerprint || ids.length === 0) return null;

  const reportLike = {
    account: params.account,
    inbox: params.inbox,
  } as unknown as ReportPayload;
  const { tenant } = await resolveTenantAndChannel(prisma, params.config, reportLike);

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId: tenant.id,
      chatwootConversationId: { in: ids },
    },
    select: { id: true },
  });
  if (conversations.length === 0) return null;

  const conversationDbIds = conversations.map((item) => item.id);
  const cached = await prisma.analysisCache.findFirst({
    where: {
      tenantId: tenant.id,
      sourceFingerprint: fingerprint,
      conversationId: { in: conversationDbIds },
    },
    include: {
      analysis: {
        select: {
          aiRawJson: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const rawJson = cached?.analysis?.aiRawJson as Record<string, unknown> | null | undefined;
  if (!rawJson || typeof rawJson !== "object") return null;
  return {
    answer: JSON.stringify(rawJson, null, 2),
  };
}

export interface ConversationDeltaStateSnapshot {
  chatwootConversationId: number;
  lastAnalyzedMessageId: number | null;
  lastAnalyzedAt: string | null;
  lastMessageAt: string | null;
  lastMessageRole: string | null;
  stateSummary: string | null;
  lastDeltaHash: string | null;
  lastStatus: string | null;
  lastLabels: string[];
  lastFullAt: string | null;
  lastRunMode: string | null;
}

export async function getConversationDeltaStates(params: {
  config: AppConfig;
  account: { id: number; name: string | null };
  inbox: { id: number; name: string | null; provider: string | null };
  conversationIds: number[];
}): Promise<{
  tenantId: string;
  channelId: string;
  statesByConversationId: Map<number, ConversationDeltaStateSnapshot>;
}> {
  const reportLike = {
    account: params.account,
    inbox: params.inbox,
  } as unknown as ReportPayload;
  const { tenant, channel } = await resolveTenantAndChannel(prisma, params.config, reportLike);
  const ids = [...new Set((params.conversationIds || []).map((id) => Number(id || 0)).filter((id) => id > 0))];

  if (ids.length === 0) {
    return {
      tenantId: tenant.id,
      channelId: channel.id,
      statesByConversationId: new Map(),
    };
  }

  const rows = await prisma.conversationDeltaState.findMany({
    where: {
      tenantId: tenant.id,
      channelId: channel.id,
      chatwootConversationId: { in: ids },
    },
    select: {
      chatwootConversationId: true,
      lastAnalyzedMessageId: true,
      lastAnalyzedAt: true,
      lastMessageAt: true,
      lastMessageRole: true,
      stateSummary: true,
      lastDeltaHash: true,
      lastStatus: true,
      lastLabels: true,
      lastFullAt: true,
      lastRunMode: true,
    },
  });

  return {
    tenantId: tenant.id,
    channelId: channel.id,
    statesByConversationId: new Map(
      rows.map((row) => [
        Number(row.chatwootConversationId),
        {
          chatwootConversationId: Number(row.chatwootConversationId),
          lastAnalyzedMessageId: row.lastAnalyzedMessageId ?? null,
          lastAnalyzedAt: row.lastAnalyzedAt ? row.lastAnalyzedAt.toISOString() : null,
          lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
          lastMessageRole: row.lastMessageRole ?? null,
          stateSummary: row.stateSummary ?? null,
          lastDeltaHash: row.lastDeltaHash ?? null,
          lastStatus: row.lastStatus ?? null,
          lastLabels: Array.isArray(row.lastLabels) ? row.lastLabels : [],
          lastFullAt: row.lastFullAt ? row.lastFullAt.toISOString() : null,
          lastRunMode: row.lastRunMode ?? null,
        } satisfies ConversationDeltaStateSnapshot,
      ]),
    ),
  };
}

export async function upsertConversationDeltaStates(params: {
  tenantId: string;
  channelId: string;
  items: Array<{
    chatwootConversationId: number;
    lastAnalyzedMessageId: number | null;
    lastAnalyzedAt: string;
    lastMessageAt: string | null;
    lastMessageRole: string | null;
    stateSummary: string | null;
    lastDeltaHash: string | null;
    lastStatus: string | null;
    lastLabels: string[];
    lastFullAt?: string | null;
    lastRunMode?: string | null;
  }>;
}) {
  const rows = (params.items || [])
    .map((item) => ({
      ...item,
      chatwootConversationId: Number(item.chatwootConversationId || 0),
    }))
    .filter((item) => item.chatwootConversationId > 0);

  for (const item of rows) {
    await prisma.conversationDeltaState.upsert({
      where: {
        tenantId_channelId_chatwootConversationId: {
          tenantId: params.tenantId,
          channelId: params.channelId,
          chatwootConversationId: item.chatwootConversationId,
        },
      },
      update: {
        lastAnalyzedMessageId: item.lastAnalyzedMessageId,
        lastAnalyzedAt: item.lastAnalyzedAt ? new Date(item.lastAnalyzedAt) : null,
        lastMessageAt: item.lastMessageAt ? new Date(item.lastMessageAt) : null,
        lastMessageRole: item.lastMessageRole,
        stateSummary: item.stateSummary,
        lastDeltaHash: item.lastDeltaHash,
        lastStatus: item.lastStatus,
        lastLabels: item.lastLabels || [],
        lastFullAt: item.lastFullAt ? new Date(item.lastFullAt) : undefined,
        lastRunMode: item.lastRunMode || undefined,
      },
      create: {
        tenantId: params.tenantId,
        channelId: params.channelId,
        chatwootConversationId: item.chatwootConversationId,
        lastAnalyzedMessageId: item.lastAnalyzedMessageId,
        lastAnalyzedAt: item.lastAnalyzedAt ? new Date(item.lastAnalyzedAt) : null,
        lastMessageAt: item.lastMessageAt ? new Date(item.lastMessageAt) : null,
        lastMessageRole: item.lastMessageRole,
        stateSummary: item.stateSummary,
        lastDeltaHash: item.lastDeltaHash,
        lastStatus: item.lastStatus,
        lastLabels: item.lastLabels || [],
        lastFullAt: item.lastFullAt ? new Date(item.lastFullAt) : null,
        lastRunMode: item.lastRunMode || null,
      },
    });
  }
}

export async function getSyncCheckpoint(params: {
  tenantId: string;
  channelId: string;
}) {
  return prisma.syncCheckpoint.findUnique({
    where: {
      tenantId_channelId: {
        tenantId: params.tenantId,
        channelId: params.channelId,
      },
    },
    select: {
      lastSyncedAt: true,
      lastChatwootCursor: true,
      updatedAt: true,
    },
  });
}

export async function upsertSyncCheckpoint(params: {
  tenantId: string;
  channelId: string;
  lastSyncedAtIso?: string | null;
  lastChatwootCursor?: string | null;
}) {
  return prisma.syncCheckpoint.upsert({
    where: {
      tenantId_channelId: {
        tenantId: params.tenantId,
        channelId: params.channelId,
      },
    },
    update: {
      lastSyncedAt: params.lastSyncedAtIso ? new Date(params.lastSyncedAtIso) : null,
      lastChatwootCursor: params.lastChatwootCursor || null,
    },
    create: {
      tenantId: params.tenantId,
      channelId: params.channelId,
      lastSyncedAt: params.lastSyncedAtIso ? new Date(params.lastSyncedAtIso) : null,
      lastChatwootCursor: params.lastChatwootCursor || null,
    },
  });
}

export async function getLatestConversationAnalysis(params: {
  config: AppConfig;
  account: { id: number; name: string | null };
  inbox: { id: number; name: string | null; provider: string | null };
  conversationIds: number[];
}): Promise<{ answer: string } | null> {
  const reportLike = {
    account: params.account,
    inbox: params.inbox,
  } as unknown as ReportPayload;
  const { tenant } = await resolveTenantAndChannel(prisma, params.config, reportLike);
  const ids = [...new Set((params.conversationIds || []).map((id) => Number(id || 0)).filter((id) => id > 0))];
  if (ids.length === 0) return null;

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId: tenant.id,
      chatwootConversationId: { in: ids },
    },
    select: { id: true },
  });
  if (!conversations.length) return null;

  const latest = await prisma.conversationAnalysis.findFirst({
    where: {
      conversationId: { in: conversations.map((conversation) => conversation.id) },
    },
    orderBy: { createdAt: "desc" },
    select: { aiRawJson: true },
  });

  const raw = latest?.aiRawJson as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== "object") return null;
  return { answer: JSON.stringify(raw, null, 2) };
}

export async function appendRunEvent(runId: string, eventType: string, payloadJson: unknown) {
  await prisma.jobEvent.create({
    data: {
      runId,
      eventType,
      payloadJson: (payloadJson as object) || {},
    },
  });
}

type RunTriggerSource = "manual" | "auto_sync" | "unknown";

type RunRequestMeta = {
  trigger_source: RunTriggerSource;
  requested_date: string;
  requested_at: string | null;
  requested_by_user_id: string | null;
  requested_by_allowed_user_id: string | null;
  requested_by_email: string | null;
  requested_by_name: string | null;
  requested_by_role: string | null;
};

type RunningRunSummary = RunRequestMeta & {
  id: string;
  date_ref: string;
  started_at: string;
  total_conversations: number;
  processed: number;
};

function normalizeRunTriggerSource(value: unknown): RunTriggerSource {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "manual") return "manual";
  if (normalized === "auto_sync" || normalized === "cron" || normalized === "automatic") return "auto_sync";
  return "unknown";
}

function readPayloadString(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = String(payload[key] || "").trim();
    if (value) return value;
  }
  return null;
}

function extractRunTriggerMeta(
  requestEvent: { payloadJson?: Prisma.JsonValue | null; createdAt?: Date } | null | undefined,
  completionEvent: { payloadJson?: Prisma.JsonValue | null } | null | undefined,
  fallbackDate: string,
): RunRequestMeta {
  const requestPayload =
    requestEvent?.payloadJson && typeof requestEvent.payloadJson === "object"
      ? (requestEvent.payloadJson as Record<string, unknown>)
      : {};
  const completionPayload =
    completionEvent?.payloadJson && typeof completionEvent.payloadJson === "object"
      ? (completionEvent.payloadJson as Record<string, unknown>)
      : {};

  const source = normalizeRunTriggerSource(
    requestPayload.source || requestPayload.trigger_source || completionPayload.source || completionPayload.trigger_source,
  );
  const requestedDate = String(requestPayload.requested_date || fallbackDate || "").trim() || fallbackDate;
  const requestedAtRaw = String(requestPayload.requested_at || "").trim();
  const requestedAt =
    requestedAtRaw ||
    (requestEvent?.createdAt instanceof Date && !Number.isNaN(requestEvent.createdAt.getTime())
      ? requestEvent.createdAt.toISOString()
      : null);
  const requestedByUserId =
    readPayloadString(requestPayload, "requested_by_user_id", "actor_user_id") ||
    readPayloadString(completionPayload, "requested_by_user_id", "actor_user_id") ||
    null;
  const requestedByAllowedUserId =
    readPayloadString(requestPayload, "requested_by_allowed_user_id") ||
    readPayloadString(completionPayload, "requested_by_allowed_user_id") ||
    null;
  const requestedByEmail =
    readPayloadString(requestPayload, "requested_by_email", "actor_email") ||
    readPayloadString(completionPayload, "requested_by_email", "actor_email") ||
    null;
  const requestedByName =
    readPayloadString(requestPayload, "requested_by_name", "actor_name") ||
    readPayloadString(completionPayload, "requested_by_name", "actor_name") ||
    null;
  const requestedByRole =
    readPayloadString(requestPayload, "requested_by_role", "actor_role") ||
    readPayloadString(completionPayload, "requested_by_role", "actor_role") ||
    null;

  return {
    trigger_source: source,
    requested_date: requestedDate,
    requested_at: requestedAt,
    requested_by_user_id: requestedByUserId,
    requested_by_allowed_user_id: requestedByAllowedUserId,
    requested_by_email: requestedByEmail,
    requested_by_name: requestedByName,
    requested_by_role: requestedByRole,
  };
}

export function formatRunInProgressMessage(
  run: Pick<
    RunningRunSummary,
    | "trigger_source"
    | "requested_by_name"
    | "requested_by_email"
    | "requested_by_role"
  > | null,
  mode: "manual" | "auto_sync" = "manual",
): string {
  const triggerSource = run?.trigger_source || "unknown";
  const requestedByName = String(run?.requested_by_name || "").trim();
  const requestedByEmail = String(run?.requested_by_email || "").trim();
  const isAutoSync = mode === "auto_sync" || triggerSource === "auto_sync" || run?.requested_by_role === "system";

  if (isAutoSync) {
    return "Já existe uma sincronização automática em andamento para esta data.";
  }

  const actorLabel = requestedByName || requestedByEmail;
  if (actorLabel) {
    return `Não é possível realizar uma execução dessa data, pois ${actorLabel} está realizando uma execução dessa mesma data agora.`;
  }

  return "Não é possível realizar uma execução dessa data, pois já existe uma execução em andamento para esta data.";
}

export async function updateRunProgress(
  runId: string,
  payload: { total?: number; processed?: number; successCount?: number; failureCount?: number },
) {
  await prisma.analysisRun.update({
    where: { id: runId },
    data: {
      totalConversations: Math.max(0, Number(payload.total || 0)),
      processed: Math.max(0, Number(payload.processed || 0)),
      successCount: Math.max(0, Number(payload.successCount || 0)),
      failureCount: Math.max(0, Number(payload.failureCount || 0)),
    },
  });
}

export async function persistAnalysisResult(params: {
  config: AppConfig;
  runId: string;
  analysis: Record<string, any>;
}) {
  const reportLike = {
    account: {
      id: Number(params.config.chatwoot.accountId || 0),
      name: params.config.chatwoot.groupName,
      role: null,
    },
    inbox: {
      id: Number(params.config.chatwoot.inboxId || 0),
      name: params.config.chatwoot.inboxName,
      provider: params.config.chatwoot.inboxProvider,
      channel_type: null,
      phone_number: null,
    },
  } as unknown as ReportPayload;

  await prisma.$transaction(async (tx) => {
    const { tenant, channel } = await resolveTenantAndChannel(tx, params.config, reportLike);
    const parsed = deriveFallbackMetricsAndProducts(
      parseJsonSafe(params.analysis.analysis?.answer),
      String(params.analysis.log_text || ""),
    );
    const derivedRiskLevel = deriveRiskLevelFromParsed(parsed);
    const contactIdentifier = String(params.analysis.contact?.identifier || "").trim();
    const contactName = toTitleCaseName(String(params.analysis.contact?.name || "").trim());
    const contact = await upsertContactByReference({
      db: tx,
      tenantId: tenant.id,
      contactKey: String(params.analysis.contact_key || ""),
      contactName,
      contactIdentifier,
    });

    const firstConversationId = Number(params.analysis.conversation_ids?.[0] || 0);
    if (firstConversationId <= 0) return;

    const conversation = await tx.conversation.upsert({
      where: {
        tenantId_chatwootConversationId: {
          tenantId: tenant.id,
          chatwootConversationId: firstConversationId,
        },
      },
      update: {
        channelId: channel.id,
        contactId: contact.id,
      },
      create: {
        tenantId: tenant.id,
        channelId: channel.id,
        contactId: contact.id,
        chatwootConversationId: firstConversationId,
        labels: [],
      },
    });

    const existingAnalysis = await tx.conversationAnalysis.findFirst({
      where: {
        runId: params.runId,
        conversationId: conversation.id,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const baseAnalysisUpdateData = {
      contactId: contact.id,
      riskLevel: derivedRiskLevel,
      summary: String(parsed.resumo || "").trim() || null,
      improvementsJson: asStringList(parsed.pontos_melhoria),
      nextStepsJson: asStringList(parsed.proximos_passos),
      aiRawJson: toJsonValue(parsed),
      finalizationStatus:
        params.analysis.conversation_operational?.[0]?.state?.finalization_status === "finalizada"
          ? "finalizada"
          : "continuada",
    } as any;

    const baseAnalysisCreateData = {
      runId: params.runId,
      conversationId: conversation.id,
      contactId: contact.id,
      riskLevel: derivedRiskLevel,
      summary: String(parsed.resumo || "").trim() || null,
      improvementsJson: asStringList(parsed.pontos_melhoria),
      nextStepsJson: asStringList(parsed.proximos_passos),
      aiRawJson: toJsonValue(parsed),
      finalizationStatus:
        params.analysis.conversation_operational?.[0]?.state?.finalization_status === "finalizada"
          ? "finalizada"
          : "continuada",
    } as any;

    const entry = existingAnalysis
      ? await tx.conversationAnalysis.update({
          where: { id: existingAnalysis.id },
          data: baseAnalysisUpdateData,
        })
      : await tx.conversationAnalysis.create({
          data: baseAnalysisCreateData,
        });

    if (existingAnalysis) {
      await tx.gap.deleteMany({ where: { analysisId: entry.id } });
      await tx.insight.deleteMany({ where: { analysisId: entry.id } });
    }

    const gaps = parseGapEntries(parsed);
    const gapRows = gaps.map((gap) => {
      const severityLabel = pickFirstText(gap, ["severidade", "severity", "nivel", "prioridade"]);
      return {
        analysisId: entry.id,
        name: pickFirstText(gap, ["nome_gap", "nome", "titulo", "title", "gap", "categoria"]) || "Gap operacional",
        severity: parseGapSeverity(severityLabel),
        description: pickFirstText(gap, ["descricao", "description", "detalhe", "detalhes", "contexto"]) || null,
        messageReference:
          pickFirstText(gap, ["mensagem_referencia", "message_reference", "referencia_mensagem", "trecho"]) || null,
        userReportedData:
          pickFirstText(gap, ["dado_informado_pelo_usuario", "dado_informado", "valor_informado"]) || null,
        confirmedData:
          pickFirstText(gap, ["dado_confirmado_pelo_acesso_infinity", "dado_confirmado", "valor_confirmado"]) || null,
        category: pickFirstText(gap, ["categoria", "category"]) || null,
        isCritical: isCriticalSeverityLabel(severityLabel),
      };
    });
    if (gapRows.length > 0) {
      await tx.gap.createMany({
        data: gapRows,
      });
    }

    const operationalInsights = allInsightsFromAnalysis(params.analysis as any);
    const insightRows = operationalInsights.map((insight) => ({
      analysisId: entry.id,
      type: insight.type || null,
      severity: parseInsightSeverity(insight.severity),
      title: String(insight.title || "Insight operacional"),
      summary: String(insight.summary || "").trim(),
      operationalStateJson: toJsonValue(insight),
    }));
    if (insightRows.length > 0) {
      await tx.insight.createMany({
        data: insightRows,
      });
    }
  }, { maxWait: 20_000, timeout: 120_000 });
}

export async function persistCompletedRun(params: {
  runId: string;
  config: AppConfig;
  date: string;
  finishedAtIso: string;
  output: ReportPayload;
}) {
  const analyses = params.output.raw_analysis?.analyses || [];
  const failures = params.output.raw_analysis?.failures || [];
  const chatwootAppBase = toChatwootAppBase(params.config.chatwoot.baseUrl);
  const accountId = Number(params.output.account?.id || params.config.chatwoot.accountId || 0);
  const inboxId = Number(params.output.inbox?.id || params.config.chatwoot.inboxId || 0);
  const compactLogItems: Array<Record<string, unknown>> = [];
  const compactRawAnalyses: Array<Record<string, unknown>> = [];

  const pendingCacheWrites: Array<{
    tenantId: string;
    sourceFingerprint: string;
    analysisId: string;
    conversationDbIds: string[];
  }> = [];

  await prisma.$transaction(async (tx) => {
    const { tenant, channel } = await resolveTenantAndChannel(tx, params.config, params.output);

    await tx.analysisRun.update({
      where: { id: params.runId },
      data: {
        tenantId: tenant.id,
        channelId: channel.id,
        status: RunStatus.completed,
        finishedAt: new Date(params.finishedAtIso),
        totalConversations: Number(params.output.summary?.total_to_process || analyses.length),
        processed: Number(params.output.summary?.processed || analyses.length + failures.length),
        successCount: analyses.length,
        failureCount: failures.length,
      },
    });

    await tx.syncCheckpoint.upsert({
      where: {
        tenantId_channelId: {
          tenantId: tenant.id,
          channelId: channel.id,
        },
      },
      update: {
        lastSyncedAt: new Date(params.finishedAtIso),
      },
      create: {
        tenantId: tenant.id,
        channelId: channel.id,
        lastSyncedAt: new Date(params.finishedAtIso),
        lastChatwootCursor: null,
      },
    });

    for (const analysis of analyses) {
      const parsed = deriveFallbackMetricsAndProducts(
        parseJsonSafe(analysis.analysis?.answer),
        String(analysis.log_text || ""),
      );
      const answerJson = JSON.stringify(parsed);
      const derivedRiskLevel = deriveRiskLevelFromParsed(parsed);
      const contactIdentifier = String(analysis.contact?.identifier || '').trim();
      const contactName = toTitleCaseName(String(analysis.contact?.name || "").trim());
      const contact = await upsertContactByReference({
        db: tx,
        tenantId: tenant.id,
        contactKey: String(analysis.contact_key || ''),
        contactName,
        contactIdentifier,
      });

      let entryIdForCache: string | null = null;
      const firstConversationId = Number(analysis.conversation_ids?.[0] || 0);
      if (firstConversationId > 0) {
        const conversation = await tx.conversation.upsert({
          where: {
            tenantId_chatwootConversationId: {
              tenantId: tenant.id,
              chatwootConversationId: firstConversationId,
            },
          },
          update: {
            channelId: channel.id,
            contactId: contact.id,
          },
          create: {
            tenantId: tenant.id,
            channelId: channel.id,
            contactId: contact.id,
            chatwootConversationId: firstConversationId,
            labels: [],
          },
        });

        const existingAnalysis = await tx.conversationAnalysis.findFirst({
          where: {
            runId: params.runId,
            conversationId: conversation.id,
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

        const baseAnalysisUpdateData: Prisma.ConversationAnalysisUncheckedUpdateInput = {
          contactId: contact.id,
          riskLevel: derivedRiskLevel,
          summary: String(parsed.resumo || "").trim() || null,
          improvementsJson: asStringList(parsed.pontos_melhoria),
          nextStepsJson: asStringList(parsed.proximos_passos),
          aiRawJson: toJsonValue(parsed),
          finalizationStatus:
            analysis.conversation_operational?.[0]?.state?.finalization_status === "finalizada" ? "finalizada" : "continuada",
        };

        const baseAnalysisCreateData: Prisma.ConversationAnalysisUncheckedCreateInput = {
          runId: params.runId,
          conversationId: conversation.id,
          contactId: contact.id,
          riskLevel: derivedRiskLevel,
          summary: String(parsed.resumo || "").trim() || null,
          improvementsJson: asStringList(parsed.pontos_melhoria),
          nextStepsJson: asStringList(parsed.proximos_passos),
          aiRawJson: toJsonValue(parsed),
          finalizationStatus:
            analysis.conversation_operational?.[0]?.state?.finalization_status === "finalizada" ? "finalizada" : "continuada",
        };

        const entry = existingAnalysis
          ? await tx.conversationAnalysis.update({
              where: { id: existingAnalysis.id },
              data: baseAnalysisUpdateData,
            })
          : await tx.conversationAnalysis.create({
              data: baseAnalysisCreateData,
            });

        entryIdForCache = entry.id;

        if (existingAnalysis) {
          await tx.gap.deleteMany({ where: { analysisId: entry.id } });
          await tx.insight.deleteMany({ where: { analysisId: entry.id } });
        }

        const gaps = parseGapEntries(parsed);
        const gapRows = gaps.map((gap) => {
          const severityLabel = pickFirstText(gap, ["severidade", "severity", "nivel", "prioridade"]);
          const severity = parseGapSeverity(severityLabel);
          const isCritical = isCriticalSeverityLabel(severityLabel);
          return {
            analysisId: entry.id,
            name: pickFirstText(gap, ["nome_gap", "nome", "titulo", "title", "gap", "categoria"]) || "Gap operacional",
            severity,
            description: pickFirstText(gap, ["descricao", "description", "detalhe", "detalhes", "contexto"]) || null,
            messageReference:
              pickFirstText(gap, ["mensagem_referencia", "message_reference", "referencia_mensagem", "trecho"]) || null,
            userReportedData:
              pickFirstText(gap, ["dado_informado_pelo_usuario", "dado_informado", "valor_informado"]) || null,
            confirmedData:
              pickFirstText(gap, ["dado_confirmado_pelo_acesso_infinity", "dado_confirmado", "valor_confirmado"]) || null,
            category: pickFirstText(gap, ["categoria", "category"]) || null,
            isCritical,
          };
        });
        if (gapRows.length > 0) {
          await tx.gap.createMany({
            data: gapRows,
          });
        }

        const operationalInsights = allInsightsFromAnalysis(analysis);
        const insightRows = operationalInsights.map((insight) => ({
          analysisId: entry.id,
          type: insight.type || null,
          severity: parseInsightSeverity(insight.severity),
          title: String(insight.title || "Insight operacional"),
          summary: String(insight.summary || "").trim(),
          operationalStateJson: toJsonValue(insight),
        }));
        if (insightRows.length > 0) {
          await tx.insight.createMany({
            data: insightRows,
          });
        }
      }

      const links = (analysis.conversation_ids || [])
        .map((id) => buildConversationLink(chatwootAppBase, accountId, inboxId, Number(id)))
        .filter(Boolean);
      const firstState = asRecord(analysis.conversation_operational?.[0]?.state);
      const aggregatedLabels = Array.from(
        new Set(
          (analysis.conversation_operational || [])
            .flatMap((entry) => {
              const state = asRecord(entry?.state);
              return Array.isArray(state.labels) ? state.labels.map((label) => String(label || "").trim()) : [];
            })
            .filter(Boolean),
        ),
      );
      const responsibleTracking = (analysis as {
        responsible_tracking?: {
          owner_bucket?: string;
          owner_label?: string;
          message_count_agent?: number;
        } | null;
      }).responsible_tracking;
      compactLogItems.push({
        contact_key: analysis.contact_key,
        contact_name: analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key,
        conversation_ids: analysis.conversation_ids || [],
        chatwoot_links: links,
        risk_level: derivedRiskLevel,
        summary: String(parsed.resumo || '').trim() || null,
        improvements: asStringList(parsed.pontos_melhoria),
        next_steps: asStringList(parsed.proximos_passos),
        finalization_status: analysis.conversation_operational?.[0]?.state?.finalization_status || null,
        finalization_actor: analysis.conversation_operational?.[0]?.state?.finalization_actor || null,
        message_count_day: analysis.message_count_day || 0,
        waiting_on_agent: asBool(firstState.waiting_on_agent),
        waiting_on_customer: asBool(firstState.waiting_on_customer),
        pending_since_at: asNumOrNull(firstState.pending_since_at),
        pending_since_at_local: firstState.pending_since_at_local ? String(firstState.pending_since_at_local) : null,
        last_interaction_at_local: firstState.last_interaction_at_local ? String(firstState.last_interaction_at_local) : null,
        trigger_after_1h_at_local: firstState.trigger_after_1h_at_local ? String(firstState.trigger_after_1h_at_local) : null,
        trigger_ready: asBool(firstState.trigger_ready),
        minutes_overdue: asNumOrNull(firstState.minutes_overdue),
        labels: aggregatedLabels.length > 0 ? aggregatedLabels : Array.isArray(firstState.labels) ? firstState.labels : [],
        responsible_bucket: String(responsibleTracking?.owner_bucket || "").trim() || null,
        responsible_label: String(responsibleTracking?.owner_label || "").trim() || null,
        responsible_message_count: Number(responsibleTracking?.message_count_agent || 0) || 0,
        created_at: params.finishedAtIso,
      });
      compactRawAnalyses.push({
        contact_key: analysis.contact_key,
        contact: analysis.contact,
        conversation_ids: analysis.conversation_ids || [],
        analysis_index: analysis.analysis_index || null,
        source_fingerprint: analysis.source_fingerprint || null,
        message_count_day: analysis.message_count_day || 0,
        log_text: analysis.log_text || "",
        conversation_operational: analysis.conversation_operational || [],
        responsible_tracking: responsibleTracking || null,
        analysis: {
          answer: answerJson || analysis.analysis?.answer || null,
        },
      });

      const sourceFingerprint = String(analysis.source_fingerprint || "").trim();
      const cacheConversationIds = (analysis.conversation_ids || []).map((id) => Number(id || 0)).filter((id) => id > 0);
      if (sourceFingerprint && cacheConversationIds.length > 0 && entryIdForCache) {
        const cacheConversations = await tx.conversation.findMany({
          where: {
            tenantId: tenant.id,
            chatwootConversationId: { in: cacheConversationIds },
          },
          select: { id: true },
        });

        if (cacheConversations.length > 0) {
          pendingCacheWrites.push({
            tenantId: tenant.id,
            sourceFingerprint,
            analysisId: entryIdForCache,
            conversationDbIds: cacheConversations.map((item) => item.id),
          });
        }
      }
    }

    await tx.report.upsert({
      where: { runId: params.runId },
      update: {
        reportMarkdown: params.output.report_markdown,
        reportJson: toJsonValue({
          date: params.output.date,
          account: params.output.account,
          inbox: params.output.inbox,
          summary: params.output.summary,
          logs_count: compactLogItems.length,
          logs: compactLogItems,
          raw_analysis: {
            analyses: compactRawAnalyses,
            failures: params.output.raw_analysis?.failures || [],
            run_stats: params.output.raw_analysis?.run_stats || null,
          },
        }),
        generatedAt: new Date(params.finishedAtIso),
        version: 'v1',
      },
      create: {
        runId: params.runId,
        reportMarkdown: params.output.report_markdown,
        reportJson: toJsonValue({
          date: params.output.date,
          account: params.output.account,
          inbox: params.output.inbox,
          summary: params.output.summary,
          logs_count: compactLogItems.length,
          logs: compactLogItems,
          raw_analysis: {
            analyses: compactRawAnalyses,
            failures: params.output.raw_analysis?.failures || [],
            run_stats: params.output.raw_analysis?.run_stats || null,
          },
        }),
        generatedAt: new Date(params.finishedAtIso),
        version: 'v1',
      },
    });

    await tx.clientRecord.deleteMany({
      where: { runId: params.runId },
    });

    const clientRecords = buildClientRecordsFromAnalyses(compactRawAnalyses as unknown as ReportPayload["raw_analysis"]["analyses"]);
    if (clientRecords.length > 0) {
      await tx.clientRecord.createMany({
        data: clientRecords.map((record) => ({
          tenantId: tenant.id,
          channelId: channel.id,
          runId: params.runId,
          dateRef: toDateRef(params.date),
          phonePk: record.phonePk,
          contactName: record.contactName || null,
          companyName: record.companyName || null,
          cnpj: record.cnpj || null,
          gapsJson: toJsonValue(record.gaps),
          attentionsJson: toJsonValue(record.attentions),
          labels: record.labels,
          conversationIds: record.conversationIds,
          chatLinks:
            record.chatLinks.length > 0
              ? record.chatLinks
              : record.conversationIds
                  .map((conversationId) =>
                    buildConversationLink(chatwootAppBase, accountId, inboxId, Number(conversationId)),
                  )
                  .filter((link): link is string => Boolean(link)),
          openedAt: record.openedAt,
          closedAt: record.closedAt,
          status: record.status,
          severity: record.severity,
          responsibleBucket: record.responsibleBucket || "ia",
          responsibleLabel: record.responsibleLabel || null,
          responsibleMessageCount: Number(record.responsibleMessageCount || 0),
          responsibleMessageBreakdown: toJsonValue(record.responsibleMessageBreakdown || null),
        })),
      });

      for (const record of clientRecords) {
        const existing = await tx.clientState.findUnique({
          where: {
            tenantId_channelId_phonePk: {
              tenantId: tenant.id,
              channelId: channel.id,
              phonePk: record.phonePk,
            },
          },
        });

        const effectiveOpenedAt = record.openedAt || new Date(params.finishedAtIso);
        const effectiveClosedAt = record.closedAt || new Date(params.finishedAtIso);
        const hasIssue = record.status === "atencao";
        const isResolved = record.status === "resolvido";
        const normalizedNextStatus = normalizeTimelineStatus(record.status);
        const movedOutOfAi = (record.labels || []).some((label) => {
          const key = String(label || "")
            .toLowerCase()
            .trim()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
          return key === "lead_agendado" || key === "pausar_ia";
        });

        if (!existing) {
          await tx.clientState.create({
            data: {
              tenantId: tenant.id,
              channelId: channel.id,
              phonePk: record.phonePk,
              contactName: record.contactName || null,
              companyName: record.companyName || null,
              cnpj: record.cnpj || null,
              firstSeenAt: effectiveOpenedAt,
              lastSeenAt: effectiveClosedAt,
              firstIssueAt: hasIssue ? effectiveOpenedAt : null,
              lastIssueAt: hasIssue ? effectiveClosedAt : null,
              resolvedAt: isResolved ? effectiveClosedAt : null,
              currentStatus: isResolved ? "resolvido" : hasIssue ? "atencao" : "aberto",
              currentSeverity: record.severity,
              currentLabels: record.labels,
              openConversationIds: isResolved ? [] : record.conversationIds,
              responsibleBucket: record.responsibleBucket || "ia",
              responsibleLabel: record.responsibleLabel || null,
              responsibleMessageCount: Number(record.responsibleMessageCount || 0),
              responsibleMessageBreakdown: toJsonValue(record.responsibleMessageBreakdown || null),
              lastRunId: params.runId,
            },
          });

          await tx.conversationTimelineEvent.create({
            data: {
              tenantId: tenant.id,
              channelId: channel.id,
              dateRef: toDateRef(params.date),
              chatwootConversationId: Number(record.conversationIds?.[0] || 0),
              phonePk: record.phonePk,
              eventType: pickTimelineEventType({
                previousStatus: null,
                nextStatus: normalizedNextStatus,
                movedOutOfAi,
              }),
              severity: record.severity,
              reason: pickTimelineReason({
                gaps: record.gaps || [],
                attentions: record.attentions || [],
                movedOutOfAi,
                fallback: "Registro inicial da conversa.",
              }),
              source: "full",
            },
          });
          continue;
        }

        const selectedSeverity =
          insightSeverityRank[String(existing.currentSeverity || "info")] >
          insightSeverityRank[String(record.severity || "info")]
            ? existing.currentSeverity
            : record.severity;

        await tx.clientState.update({
          where: { id: existing.id },
          data: {
            contactName: record.contactName || existing.contactName,
            companyName: record.companyName || existing.companyName,
            cnpj: record.cnpj || existing.cnpj,
            firstSeenAt: existing.firstSeenAt < effectiveOpenedAt ? existing.firstSeenAt : effectiveOpenedAt,
            lastSeenAt: existing.lastSeenAt > effectiveClosedAt ? existing.lastSeenAt : effectiveClosedAt,
            firstIssueAt: hasIssue
              ? existing.firstIssueAt
                ? existing.firstIssueAt < effectiveOpenedAt
                  ? existing.firstIssueAt
                  : effectiveOpenedAt
                : effectiveOpenedAt
              : existing.firstIssueAt,
            lastIssueAt: hasIssue ? effectiveClosedAt : existing.lastIssueAt,
            resolvedAt: isResolved ? effectiveClosedAt : null,
            currentStatus: isResolved ? "resolvido" : hasIssue ? "atencao" : "aberto",
            currentSeverity: selectedSeverity,
            currentLabels: record.labels,
            openConversationIds: isResolved ? [] : record.conversationIds,
            responsibleBucket: record.responsibleBucket || "ia",
            responsibleLabel: record.responsibleLabel || null,
            responsibleMessageCount: Number(record.responsibleMessageCount || 0),
            responsibleMessageBreakdown: toJsonValue(record.responsibleMessageBreakdown || null),
            lastRunId: params.runId,
          },
        });

        await tx.conversationTimelineEvent.create({
          data: {
            tenantId: tenant.id,
            channelId: channel.id,
            dateRef: toDateRef(params.date),
            chatwootConversationId: Number(record.conversationIds?.[0] || 0),
            phonePk: record.phonePk,
            eventType: pickTimelineEventType({
              previousStatus: normalizeTimelineStatus(existing.currentStatus),
              nextStatus: normalizedNextStatus,
              movedOutOfAi,
            }),
            severity: record.severity,
            reason: pickTimelineReason({
              gaps: record.gaps || [],
              attentions: record.attentions || [],
              movedOutOfAi,
              fallback: `Atualizacao operacional de status: ${existing.currentStatus} -> ${normalizedNextStatus}.`,
            }),
            source: "full",
          },
        });
      }
    }

    await tx.analysisRun.deleteMany({
      where: {
        id: { not: params.runId },
        tenantId: tenant.id,
        channelId: channel.id,
        dateRef: toDateRef(params.date),
        status: RunStatus.completed,
        report: {
          isNot: null,
        },
      },
    });
  }, { maxWait: 20_000, timeout: 600_000 });

  for (const cacheWrite of pendingCacheWrites) {
    try {
      await prisma.analysisCache.deleteMany({
        where: {
          tenantId: cacheWrite.tenantId,
          sourceFingerprint: cacheWrite.sourceFingerprint,
          conversationId: { in: cacheWrite.conversationDbIds },
        },
      });
      await prisma.analysisCache.createMany({
        data: cacheWrite.conversationDbIds.map((conversationId) => ({
          tenantId: cacheWrite.tenantId,
          conversationId,
          sourceFingerprint: cacheWrite.sourceFingerprint,
          analysisId: cacheWrite.analysisId,
        })),
      });
    } catch (error) {
      console.warn(
        `[audit-persistence] falha ao atualizar cache de análise (${cacheWrite.sourceFingerprint}):`,
        error,
      );
    }
  }

  invalidateAuditReadCache();
}

export async function markRunFailed(runId: string, finishedAtIso: string, message: string) {
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  const isTransientDbError = (error: unknown): boolean => {
    const code = String((error as { code?: string } | null)?.code || "").toUpperCase();
    const text = String((error as Error | null)?.message || "").toLowerCase();
    return (
      code === "P2024" ||
      code === "P1001" ||
      code === "P1008" ||
      text.includes("connection pool") ||
      text.includes("server has closed the connection") ||
      text.includes("connectionreset") ||
      text.includes("econnreset") ||
      text.includes("connect timeout")
    );
  };

  const retry = async <T>(fn: () => Promise<T>, label: string): Promise<T> => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < 3 && isTransientDbError(error)) {
          await sleep(350 * attempt);
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Falha ao executar ${label}.`);
  };

  try {
    await retry(
      () =>
        prisma.analysisRun.update({
          where: { id: runId },
          data: {
            status: RunStatus.failed,
            finishedAt: new Date(finishedAtIso),
          },
        }),
      "analysisRun.update",
    );
  } catch (error) {
    console.error("[audit-persistence] não foi possível atualizar run para failed:", error);
    return;
  }

  try {
    const normalized = String(message || "").toLowerCase();
    const failure_kind =
      normalized.includes("quota") || normalized.includes("rate limit") || normalized.includes("429")
        ? "quota"
        : normalized.includes("timeout") || normalized.includes("heartbeat") || normalized.includes("inatividade")
          ? "timeout"
          : normalized.includes("stale")
            ? "stale"
            : "generic";
    await retry(() => appendRunEvent(runId, "run_failed", { message, failure_kind }), "appendRunEvent(run_failed)");
  } catch (error) {
    console.warn("[audit-persistence] falha ao registrar evento run_failed:", error);
  }

  invalidateAuditReadCache();
}

function getRunningStaleMinutes(): number {
  const raw = Number(process.env.REPORT_JOB_RUNNING_STALE_MINUTES || process.env.ANALYSIS_RUNNING_STALE_MINUTES || 30);
  if (!Number.isFinite(raw)) return 30;
  return Math.min(240, Math.max(5, Math.floor(raw)));
}

let lastStaleCleanupAt = 0;

async function cleanupStaleRunningRuns(where: {
  tenantId?: string;
  channelId?: string;
  dateRef?: Date;
} = {}) {
  const now = Date.now();
  const isGlobalCleanup = !where.tenantId && !where.channelId && !where.dateRef;
  const cleanupCooldownMs = Number(process.env.REPORT_STALE_CLEANUP_COOLDOWN_MS || 30_000);

  if (isGlobalCleanup && Number.isFinite(cleanupCooldownMs) && now - lastStaleCleanupAt < cleanupCooldownMs) {
    return;
  }

  lastStaleCleanupAt = now;

  const staleMinutes = getRunningStaleMinutes();
  const staleBefore = new Date(now - staleMinutes * 60 * 1000);

  const rows = await prisma.analysisRun.findMany({
    where: {
      status: RunStatus.running,
      finishedAt: null,
      ...(where.tenantId ? { tenantId: where.tenantId } : {}),
      ...(where.channelId ? { channelId: where.channelId } : {}),
      ...(where.dateRef ? { dateRef: where.dateRef } : {}),
    },
    select: {
      id: true,
      startedAt: true,
      events: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  for (const run of rows) {
    const heartbeat = run.events?.[0]?.createdAt || run.startedAt;
    if (!(heartbeat instanceof Date) || Number.isNaN(heartbeat.getTime())) continue;
    if (heartbeat >= staleBefore) continue;
    await markRunFailed(
      run.id,
      new Date().toISOString(),
      `Execução marcada como falha por inatividade superior a ${staleMinutes} minuto(s).`,
    );
  }
}

export async function listRecentRuns(limit: number) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit || 10)));
  const cacheKey = `recent-runs:${safeLimit}`;
  const cached = readAuditCache<unknown>(cacheKey);
  if (cached) return cached as any;
  await cleanupStaleRunningRuns();
  const rows = await prisma.analysisRun.findMany({
    where: {
      status: RunStatus.completed,
      report: {
        isNot: null,
      },
    },
    take: safeLimit,
    orderBy: { startedAt: "desc" },
    include: {
      report: true,
      channel: true,
      tenant: true,
      events: {
        where: {
          eventType: { in: ["run_requested", "run_completed"] },
        },
        orderBy: { createdAt: "asc" },
        select: {
          eventType: true,
          payloadJson: true,
          createdAt: true,
        },
      },
    },
  });

  const result = rows
    .map((row) => {
      const reportJson = (row.report?.reportJson as Record<string, unknown> | null) || null;
      const requestEvent = row.events.find((event) => event.eventType === "run_requested");
      const completionEvent = row.events.find((event) => event.eventType === "run_completed");
      const triggerMeta = extractRunTriggerMeta(requestEvent, completionEvent, row.dateRef.toISOString().slice(0, 10));
      return {
        report_json: reportJson,
        id: row.id,
        status: row.status,
        date_ref: row.dateRef.toISOString().slice(0, 10),
        report_date: row.dateRef.toISOString().slice(0, 10),
        trigger_source: triggerMeta.trigger_source,
        requested_date: triggerMeta.requested_date,
        requested_at: triggerMeta.requested_at,
        requested_by_user_id: triggerMeta.requested_by_user_id,
        requested_by_allowed_user_id: triggerMeta.requested_by_allowed_user_id,
        requested_by_email: triggerMeta.requested_by_email,
        requested_by_name: triggerMeta.requested_by_name,
        requested_by_role: triggerMeta.requested_by_role,
        started_at: row.startedAt.toISOString(),
        finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
        total_conversations: row.totalConversations,
        processed: row.processed,
        success_count: row.successCount,
        failure_count: row.failureCount,
        tenant: row.tenant.name,
        channel: row.channel.name,
        has_report: Boolean(row.report),
      };
    })
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  return writeAuditCache(cacheKey, result);
}

export async function getRunSnapshot(runId: string) {
  const run = await prisma.analysisRun.findUnique({
    where: { id: runId },
    include: {
      report: true,
      events: {
        where: {
          eventType: {
            in: ["run_requested", "run_completed", "contact_start", "contact_heartbeat", "contact_done", "run_failed"],
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          eventType: true,
          payloadJson: true,
          createdAt: true,
        },
      },
    },
  });

  if (!run) return null;

  const requestEvent = [...run.events].reverse().find((event) => event.eventType === "run_requested");
  const completionEvent = [...run.events].reverse().find((event) => event.eventType === "run_completed");
  const latestEventAt = run.events?.[0]?.createdAt ? run.events[0].createdAt.toISOString() : null;
  const triggerMeta = extractRunTriggerMeta(requestEvent, completionEvent, run.dateRef.toISOString().slice(0, 10));

  return {
    run: {
      id: run.id,
      status: run.status,
      date_ref: run.dateRef.toISOString().slice(0, 10),
      report_date: run.dateRef.toISOString().slice(0, 10),
      trigger_source: triggerMeta.trigger_source,
      requested_date: triggerMeta.requested_date,
      requested_at: triggerMeta.requested_at,
      requested_by_user_id: triggerMeta.requested_by_user_id,
      requested_by_allowed_user_id: triggerMeta.requested_by_allowed_user_id,
      requested_by_email: triggerMeta.requested_by_email,
      requested_by_name: triggerMeta.requested_by_name,
      requested_by_role: triggerMeta.requested_by_role,
      started_at: run.startedAt.toISOString(),
      finished_at: run.finishedAt ? run.finishedAt.toISOString() : null,
      last_event_at: latestEventAt,
      total_conversations: run.totalConversations,
      processed: run.processed,
      success_count: run.successCount,
      failure_count: run.failureCount,
    },
    report_markdown: run.report?.reportMarkdown || null,
    report_json: (run.report?.reportJson as Record<string, unknown> | null) || null,
  };
}

export async function getCurrentContactFromRunEvents(runId: string): Promise<{
  sequence: number;
  total: number;
  contact_name: string;
  contact_key: string;
  analysis_key: string | null;
  conversation_ids: number[];
} | null> {
  const lastStart = await prisma.jobEvent.findFirst({
    where: {
      runId,
      eventType: "contact_start",
    },
    orderBy: { createdAt: "desc" },
    select: {
      payloadJson: true,
    },
  });

  if (!lastStart?.payloadJson || typeof lastStart.payloadJson !== "object") return null;
  const payload = lastStart.payloadJson as Record<string, unknown>;
  const sequence = Math.max(0, Number(payload.sequence || 0));
  const total = Math.max(0, Number(payload.total || 0));
  const contactKey = String(payload.contact_key || "").trim();
  const contactName = String(payload.contact_name || contactKey || "Contato").trim();
  const analysisKeyRaw = String(payload.analysis_key || "").trim();
  const conversationIds = Array.isArray(payload.conversation_ids)
    ? payload.conversation_ids
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    : [];

  return {
    sequence,
    total,
    contact_name: contactName,
    contact_key: contactKey,
    analysis_key: analysisKeyRaw || null,
    conversation_ids: conversationIds,
  };
}

export async function getCurrentWaitStateFromRunEvents(runId: string): Promise<{
  wait_message: string | null;
  wait_reason: string | null;
  wait_retry_after_ms: number | null;
  wait_attempt: number | null;
  wait_max_attempts: number | null;
  wait_next_retry_at: string | null;
} | null> {
  const [lastWait, lastCompletion] = await Promise.all([
    prisma.jobEvent.findFirst({
      where: {
        runId,
        eventType: "contact_wait",
      },
      orderBy: { createdAt: "desc" },
      select: {
        payloadJson: true,
        createdAt: true,
      },
    }),
    prisma.jobEvent.findFirst({
      where: {
        runId,
        eventType: {
          in: ["contact_done", "run_completed", "run_failed"],
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
      },
    }),
  ]);

  if (!lastWait?.payloadJson || typeof lastWait.payloadJson !== "object") return null;
  const waitCreatedAt = lastWait.createdAt instanceof Date ? lastWait.createdAt.getTime() : 0;
  const completionCreatedAt = lastCompletion?.createdAt instanceof Date ? lastCompletion.createdAt.getTime() : 0;
  if (!waitCreatedAt || (completionCreatedAt && completionCreatedAt > waitCreatedAt)) return null;

  const payload = lastWait.payloadJson as Record<string, unknown>;

  return {
    wait_message: String(payload.wait_message || "").trim() || null,
    wait_reason: String(payload.wait_reason || "").trim() || null,
    wait_retry_after_ms: Number(payload.wait_retry_after_ms || 0) || null,
    wait_attempt: Number(payload.wait_attempt || 0) || null,
    wait_max_attempts: Number(payload.wait_max_attempts || 0) || null,
    wait_next_retry_at: String(payload.wait_next_retry_at || "").trim() || null,
  };
}

export async function listAvailableReportDates(limit = 365) {
  const safeLimit = Math.max(1, Math.min(2000, Number(limit || 365)));
  const cacheKey = `available-dates:${safeLimit}`;
  const cached = readAuditCache<unknown>(cacheKey);
  if (cached) return cached as string[];
  await cleanupStaleRunningRuns();
  const rows = await prisma.analysisRun.findMany({
    where: {
      status: RunStatus.completed,
      report: {
        isNot: null,
      },
    },
    orderBy: [{ dateRef: "desc" }, { startedAt: "desc" }],
    take: safeLimit,
    select: {
      dateRef: true,
      report: {
        select: {
          reportJson: true,
        },
      },
    },
  });

  const validDates = new Set<string>();

  for (const row of rows) {
    const dateRef = row.dateRef.toISOString().slice(0, 10);
    if (validDates.has(dateRef)) continue;
    const reportJson = (row.report?.reportJson as Record<string, unknown> | null) || null;
    if (hasRenderableReportData(reportJson)) {
      validDates.add(dateRef);
    }
  }

  return writeAuditCache(cacheKey, Array.from(validDates));
}

export async function getLatestRunByDate(date: string) {
  const safeDate = String(date || "").trim();
  const cacheKey = `latest-run:${safeDate}`;
  const cached = readAuditCache<unknown>(cacheKey);
  if (cached) return cached as any;
  await cleanupStaleRunningRuns({ dateRef: toDateRef(date) });
  const runs = await prisma.analysisRun.findMany({
    where: {
      dateRef: toDateRef(date),
      status: RunStatus.completed,
      report: {
        isNot: null,
      },
    },
    orderBy: { startedAt: "desc" },
    take: 10,
    include: {
      report: true,
      channel: true,
      tenant: true,
      events: {
        where: {
          eventType: { in: ["run_requested", "run_completed"] },
        },
        orderBy: { createdAt: "asc" },
        select: {
          eventType: true,
          payloadJson: true,
          createdAt: true,
        },
      },
    },
  });

  const run = runs.find((item) => {
    const reportJson = (item.report?.reportJson as Record<string, unknown> | null) || null;
    return hasRenderableReportData(reportJson);
  });

  if (!run) return null;
  const requestEvent = run.events.find((event) => event.eventType === "run_requested");
  const completionEvent = run.events.find((event) => event.eventType === "run_completed");
  const triggerMeta = extractRunTriggerMeta(requestEvent, completionEvent, run.dateRef.toISOString().slice(0, 10));

  return writeAuditCache(cacheKey, {
    id: run.id,
    status: run.status,
    date_ref: run.dateRef.toISOString().slice(0, 10),
    report_date: run.dateRef.toISOString().slice(0, 10),
    started_at: run.startedAt.toISOString(),
    finished_at: run.finishedAt ? run.finishedAt.toISOString() : null,
    total_conversations: run.totalConversations,
    processed: run.processed,
    trigger_source: triggerMeta.trigger_source,
    requested_date: triggerMeta.requested_date,
    requested_at: triggerMeta.requested_at,
    requested_by_user_id: triggerMeta.requested_by_user_id,
    requested_by_allowed_user_id: triggerMeta.requested_by_allowed_user_id,
    requested_by_email: triggerMeta.requested_by_email,
    requested_by_name: triggerMeta.requested_by_name,
    requested_by_role: triggerMeta.requested_by_role,
    success_count: run.successCount,
    failure_count: run.failureCount,
    tenant: run.tenant.name,
    channel: run.channel.name,
    has_report: Boolean(run.report),
    report_json: (run.report?.reportJson as Record<string, unknown> | null) || null,
    report_markdown: run.report?.reportMarkdown || null,
  });
}

export async function listRunsByDate(date: string) {
  const safeDate = String(date || "").trim();
  const cacheKey = `runs-by-date:${safeDate}`;
  const cached = readAuditCache<unknown>(cacheKey);
  if (cached) return cached as any;
  await cleanupStaleRunningRuns({ dateRef: toDateRef(date) });
  const rows = await prisma.analysisRun.findMany({
    where: {
      dateRef: toDateRef(date),
      status: RunStatus.completed,
      report: {
        isNot: null,
      },
    },
    orderBy: { startedAt: "asc" },
    include: {
      report: true,
      channel: true,
      tenant: true,
      events: {
        where: {
          eventType: { in: ["run_requested", "run_completed"] },
        },
        orderBy: { createdAt: "asc" },
        select: {
          eventType: true,
          payloadJson: true,
          createdAt: true,
        },
      },
    },
  });

  const result = rows
    .map((row) => {
      const reportJson = (row.report?.reportJson as Record<string, unknown> | null) || null;
      const requestEvent = row.events.find((event) => event.eventType === "run_requested");
      const completionEvent = row.events.find((event) => event.eventType === "run_completed");
      const triggerMeta = extractRunTriggerMeta(requestEvent, completionEvent, row.dateRef.toISOString().slice(0, 10));
      return {
        report_json: reportJson,
        id: row.id,
        status: row.status,
        date_ref: row.dateRef.toISOString().slice(0, 10),
        report_date: row.dateRef.toISOString().slice(0, 10),
        trigger_source: triggerMeta.trigger_source,
        requested_date: triggerMeta.requested_date,
        requested_at: triggerMeta.requested_at,
        requested_by_user_id: triggerMeta.requested_by_user_id,
        requested_by_allowed_user_id: triggerMeta.requested_by_allowed_user_id,
        requested_by_email: triggerMeta.requested_by_email,
        requested_by_name: triggerMeta.requested_by_name,
        requested_by_role: triggerMeta.requested_by_role,
        started_at: row.startedAt.toISOString(),
        finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
        total_conversations: row.totalConversations,
        processed: row.processed,
        success_count: row.successCount,
        failure_count: row.failureCount,
        tenant: row.tenant.name,
        channel: row.channel.name,
        has_report: hasRenderableReportData(reportJson),
      };
    })
    .filter((row) => row.has_report);

  return writeAuditCache(cacheKey, result);
}

export async function getRunningRunByDate(date: string) {
  await cleanupStaleRunningRuns({ dateRef: toDateRef(date) });
  const run = await prisma.analysisRun.findFirst({
    where: {
      dateRef: toDateRef(date),
      status: RunStatus.running,
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      dateRef: true,
      startedAt: true,
      totalConversations: true,
      processed: true,
      events: {
        where: {
          eventType: { in: ["run_requested", "run_completed"] },
        },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          eventType: true,
          payloadJson: true,
          createdAt: true,
        },
      },
    },
  });

  if (!run) return null;
  const requestEvent = run.events.find((event) => event.eventType === "run_requested") || run.events[0] || null;
  const triggerMeta = extractRunTriggerMeta(requestEvent, null, run.dateRef.toISOString().slice(0, 10));

  return {
    id: run.id,
    date_ref: run.dateRef.toISOString().slice(0, 10),
    started_at: run.startedAt.toISOString(),
    total_conversations: run.totalConversations,
    processed: run.processed,
    trigger_source: triggerMeta.trigger_source,
    requested_date: triggerMeta.requested_date,
    requested_at: triggerMeta.requested_at,
    requested_by_user_id: triggerMeta.requested_by_user_id,
    requested_by_allowed_user_id: triggerMeta.requested_by_allowed_user_id,
    requested_by_email: triggerMeta.requested_by_email,
    requested_by_name: triggerMeta.requested_by_name,
    requested_by_role: triggerMeta.requested_by_role,
  };
}

export async function listClientsByDate(date: string) {
  const normalizeMatchKey = (value: string) =>
    String(value || "")
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const runsForDate = await prisma.analysisRun.findMany({
    where: {
      dateRef: toDateRef(date),
      status: RunStatus.completed,
      report: {
        isNot: null,
      },
    },
    orderBy: { startedAt: "desc" },
    take: 8,
    select: {
      id: true,
      tenantId: true,
      channelId: true,
      dateRef: true,
      startedAt: true,
      report: {
        select: {
          reportJson: true,
        },
      },
      channel: {
        select: {
          chatwootAccountId: true,
          chatwootInboxId: true,
        },
      },
      clientRecords: {
        orderBy: [{ status: "asc" }, { contactName: "asc" }],
        select: {
          phonePk: true,
          contactName: true,
          companyName: true,
          cnpj: true,
          gapsJson: true,
          attentionsJson: true,
          labels: true,
          conversationIds: true,
          chatLinks: true,
          openedAt: true,
          closedAt: true,
          status: true,
          severity: true,
          responsibleBucket: true,
          responsibleLabel: true,
          responsibleMessageCount: true,
          responsibleMessageBreakdown: true,
        },
      },
    },
  });

  const runForDate =
    runsForDate.find((run) => {
      const reportJson = (run.report?.reportJson as Record<string, unknown> | null) || null;
      const hasReportPayload = hasRenderableReportData(reportJson);
      const hasClientSignals = (run.clientRecords || []).some((item) => {
        const hasGaps = Array.isArray(item.gapsJson) && item.gapsJson.length > 0;
        const hasAttentions = Array.isArray(item.attentionsJson) && item.attentionsJson.length > 0;
        const hasLinks = Array.isArray(item.chatLinks) && item.chatLinks.length > 0;
        return hasGaps || hasAttentions || hasLinks;
      });
      return hasReportPayload || hasClientSignals;
    }) ||
    runsForDate[0] ||
    null;

  const contextRun =
    runForDate ||
    (await prisma.analysisRun.findFirst({
      where: {
        status: RunStatus.completed,
        report: {
          isNot: null,
        },
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        channelId: true,
        dateRef: true,
        startedAt: true,
        channel: {
          select: {
            chatwootAccountId: true,
            chatwootInboxId: true,
          },
        },
      },
    }));

  if (!contextRun) {
    return {
      date,
      runId: null,
      generatedAt: null,
      source: "none",
      items: [],
    };
  }

  const safeQuery = async <T>(label: string, query: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await query();
    } catch (error) {
      console.warn(`[audit-persistence] listClientsByDate(${date}) falha em ${label}:`, error);
      return fallback;
    }
  };

  const states = await safeQuery(
    "clientState.findMany",
    () =>
      prisma.clientState.findMany({
        where: {
          tenantId: contextRun.tenantId,
          channelId: contextRun.channelId,
          phonePk: {
            in: (runForDate?.clientRecords || []).map((item) => item.phonePk),
          },
        },
        select: {
          phonePk: true,
          firstSeenAt: true,
          lastSeenAt: true,
          firstIssueAt: true,
          lastIssueAt: true,
          resolvedAt: true,
          currentStatus: true,
          currentSeverity: true,
          responsibleBucket: true,
          responsibleLabel: true,
          responsibleMessageCount: true,
          responsibleMessageBreakdown: true,
        },
      }),
    [] as Array<{
      phonePk: string;
      firstSeenAt: Date | null;
      lastSeenAt: Date | null;
      firstIssueAt: Date | null;
      lastIssueAt: Date | null;
      resolvedAt: Date | null;
      currentStatus: string | null;
      currentSeverity: string | null;
      responsibleBucket: string | null;
      responsibleLabel: string | null;
      responsibleMessageCount: number | null;
      responsibleMessageBreakdown: unknown;
    }>,
  );
  const stateByPhone = new Map(states.map((item) => [item.phonePk, item]));
  const phonesForTimeline = Array.from(new Set((runForDate?.clientRecords || []).map((item) => String(item.phonePk || "").trim()).filter(Boolean)));
  const timelineEvents = phonesForTimeline.length
    ? await safeQuery(
        "conversationTimelineEvent.findMany",
        () =>
          prisma.conversationTimelineEvent.findMany({
            where: {
              tenantId: contextRun.tenantId,
              channelId: contextRun.channelId,
              phonePk: { in: phonesForTimeline },
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
          }),
        [] as Array<{
          phonePk: string | null;
          dateRef: Date;
          chatwootConversationId: number | null;
          eventType: string | null;
          severity: string | null;
          reason: string | null;
          source: string | null;
          createdAt: Date;
        }>,
      )
    : [];
  const timelineByPhone = new Map<string, Array<{
    dateRef: string;
    conversationId: number;
    eventType: string;
    severity: string;
    reason: string;
    source: string;
    createdAt: string;
  }>>();

  const normalizeSeverityText = (value: unknown): string => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "info";
    if (raw.includes("crit")) return "critical";
    if (raw.includes("high") || raw.includes("alt")) return "high";
    if (raw.includes("medium") || raw.includes("med")) return "medium";
    if (raw.includes("low") || raw.includes("baix")) return "low";
    if (raw === "non_critical") return "info";
    if (raw.includes("info")) return "info";
    return "info";
  };
  const normalizeStatusText = (value: unknown): "entrada" | "atencao" | "resolvido" => {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "resolvido") return "resolvido";
    if (raw === "atencao") return "atencao";
    return "entrada";
  };
  const normalizeLabelText = (value: unknown): string =>
    String(value || "")
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const hasExitLabel = (labels: string[]): boolean => {
    const normalized = labels.map((label) => normalizeLabelText(label));
    return normalized.includes("lead_agendado") || normalized.includes("pausar_ia");
  };
  const hasRemarketingIntent = (params: { labels: string[]; gaps: string[]; attentions: string[] }): boolean => {
    const normalizedLabels = params.labels.map((label) => normalizeLabelText(label));
    if (normalizedLabels.includes("ia_remarketing")) return true;

    const corpus = normalizeLabelText([...params.gaps, ...params.attentions].join(" "));
    return /\b(consultor|atendente|video chamada|videochamada|reuniao|videoconferencia|video call|agendar call|falar com atendente)\b/.test(corpus);
  };
  const asFiniteNumber = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const parseIsoDate = (value: unknown): Date | null => {
    const text = String(value || "").trim();
    if (!text) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  type PendingContext = {
    waitingOnAgent: boolean;
    pendingHours: number | null;
    labels: string[];
    source: "conversation" | "name";
  };
  type ResponsibleBucket = "ia" | "suellen" | "samuel";
  type ResponsibleTracking = {
    bucket: ResponsibleBucket;
    label: string;
    messageCount: number;
    breakdown: {
      ia: number;
      suellen: number;
      samuel: number;
    };
  };
  const responsibleLabel = (bucket: ResponsibleBucket): string => {
    if (bucket === "samuel") return "Comercial Samuel";
    if (bucket === "suellen") return "Comercial Suellen";
    return "IA";
  };
  const resolveResponsibleBucket = (senderName: unknown, inboxId: unknown): ResponsibleBucket | null =>
    resolveResponsibleBucketBySenderName(senderName, inboxId);
  const classifyPipelineBlock = (params: {
    status: string;
    severity: string;
    labels: string[];
    gaps: string[];
    attentions: string[];
    pendingContext: PendingContext | null;
  }) => {
    const normalizedStatus = normalizeStatusText(params.status);
    const normalizedSeverity = normalizeSeverityText(params.severity);
    const labels = (params.labels || []).map((label) => String(label || "").trim()).filter(Boolean);
    const resolved = normalizedStatus === "resolvido" || hasExitLabel(labels);
    const isAttention = normalizedStatus === "atencao" || normalizedSeverity === "critical" || normalizedSeverity === "high";
    const pendingHours = params.pendingContext?.pendingHours ?? null;
    const inWindow = pendingHours !== null && pendingHours >= 6 && pendingHours <= 24;
    const staleOver24h = pendingHours !== null && pendingHours > 24;
    const intent = hasRemarketingIntent({
      labels: [...labels, ...(params.pendingContext?.labels || [])],
      gaps: params.gaps || [],
      attentions: params.attentions || [],
    });

    const eligible = !resolved && !isAttention && inWindow && intent;
    const block: "entrada" | "remarketing" | "atencao" | "resolvido" = resolved
      ? "resolvido"
      : isAttention
        ? "atencao"
        : eligible
          ? "remarketing"
          : "entrada";

    let reason: string | null = null;
    let ruleMatched: string | null = null;
    if (eligible) {
      reason = `Lead com sinal de consultor/videochamada aguardando ${pendingHours?.toFixed(1)}h sem retorno da equipe.`;
      ruleMatched = "remarketing_6h_24h_with_consultant_intent";
    } else if (staleOver24h && intent) {
      reason = "Lead com sinal de remarketing fora da janela (mais de 24h sem resposta).";
      ruleMatched = "remarketing_outside_window_over_24h";
    }

    return {
      pipelineBlock: block,
      remarketing: {
        eligible,
        pendingHours,
        reason,
        ruleMatched,
      },
    };
  };
  for (const event of timelineEvents) {
    const key = String(event.phonePk || "").trim();
    if (!key) continue;
    if (!timelineByPhone.has(key)) timelineByPhone.set(key, []);
    timelineByPhone.get(key)?.push({
      dateRef: event.dateRef.toISOString().slice(0, 10),
      conversationId: Number(event.chatwootConversationId || 0),
      eventType: String(event.eventType || ""),
      severity: String(event.severity || ""),
      reason: String(event.reason || ""),
      source: String(event.source || ""),
      createdAt: event.createdAt.toISOString(),
    });
  }

  const reportDrafts = (() => {
    const reportJson = (runForDate?.report?.reportJson as Record<string, unknown> | null) || null;
    const rawAnalysis = (reportJson?.raw_analysis || {}) as Record<string, unknown>;
    const analyses = Array.isArray(rawAnalysis.analyses) ? (rawAnalysis.analyses as ReportPayload["raw_analysis"]["analyses"]) : [];
    if (!analyses?.length) return [] as ReturnType<typeof buildClientRecordsFromAnalyses>;
    return buildClientRecordsFromAnalyses(analyses);
  })();

  const reportFallbackByPhone = new Map<
    string,
    {
      gaps: string[];
      attentions: string[];
      contactName: string;
      labels: string[];
      severity: string;
      status: string;
      conversationIds: number[];
      chatLinks: string[];
      products: string[];
      clientPhase: "inicial" | "intermediario" | "avancado";
      clientPhaseReason: string;
      openedAt: Date | null;
      closedAt: Date | null;
    }
  >();
  const reportFallbackByName = new Map<
    string,
    {
      gaps: string[];
      attentions: string[];
      contactName: string;
      labels: string[];
      severity: string;
      status: string;
      conversationIds: number[];
      chatLinks: string[];
      products: string[];
      clientPhase: "inicial" | "intermediario" | "avancado";
      clientPhaseReason: string;
      openedAt: Date | null;
      closedAt: Date | null;
    }
  >();
  const reportFallbackByConversationId = new Map<
    number,
    {
      products: string[];
      clientPhase: "inicial" | "intermediario" | "avancado";
      clientPhaseReason: string;
    }
  >();

  const reportLogs = (() => {
    const reportJson = (runForDate?.report?.reportJson as Record<string, unknown> | null) || null;
    return Array.isArray(reportJson?.logs) ? (reportJson.logs as Array<Record<string, unknown>>) : [];
  })();
  const trackedConversationIds = Array.from(
    new Set([
      ...(runForDate?.clientRecords || []).flatMap((item) => (Array.isArray(item.conversationIds) ? item.conversationIds : [])),
      ...reportDrafts.flatMap((item) => (Array.isArray(item.conversationIds) ? item.conversationIds : [])),
      ...reportLogs.flatMap((item) =>
        Array.isArray(item.conversation_ids)
          ? item.conversation_ids.map((id) => Number(id || 0)).filter((id) => id > 0)
          : [],
      ),
    ]),
  )
    .map((id) => Number(id || 0))
    .filter((id) => id > 0);
  const conversationResponsibleMap = new Map<
    number,
    {
      counts: { ia: number; suellen: number; samuel: number };
      last: { bucket: ResponsibleBucket; at: number } | null;
    }
  >();
  if (trackedConversationIds.length > 0) {
    const rows = await safeQuery(
      "message.findMany",
      () =>
        prisma.message.findMany({
          where: {
            tenantId: contextRun.tenantId,
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
      [] as Array<{
        senderName: string | null;
        createdAt: Date;
        conversation: {
          chatwootConversationId: number | null;
          channel: { chatwootInboxId: number | null } | null;
        } | null;
      }>,
    );
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
  const buildResponsibleTracking = (conversationIds: number[]): ResponsibleTracking => {
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
      if (entry.last && (!latest || entry.last.at > latest.at)) {
        latest = { ...entry.last };
      }
    }
    const ranked = (Object.entries(counts) as Array<[ResponsibleBucket, number]>).sort((a, b) => b[1] - a[1]);
    const fallbackBucket: ResponsibleBucket = latest?.bucket || (ranked[0]?.[1] > 0 ? ranked[0][0] : "ia");
    const messageCount = counts[fallbackBucket] || 0;
    return {
      bucket: fallbackBucket,
      label: responsibleLabel(fallbackBucket),
      messageCount,
      breakdown: counts,
    };
  };
  const normalizeStoredResponsibleBucket = (value: unknown): ResponsibleBucket => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "suellen" || normalized === "samuel") return normalized;
    return "ia";
  };
  const toSafeInt = (value: unknown): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  };
  const buildResponsibleTrackingFromStored = (params: {
    bucket: unknown;
    label: unknown;
    messageCount: unknown;
    breakdown: unknown;
    conversationIds: number[];
  }): ResponsibleTracking => {
    const fallback = buildResponsibleTracking(params.conversationIds || []);
    const rawBreakdown = asRecord(params.breakdown);
    const normalizedBreakdown = sanitizeBreakdownByInbox(rawBreakdown, runForDate?.channel?.chatwootInboxId || null);
    const hasBreakdown =
      normalizedBreakdown.ia > 0 || normalizedBreakdown.suellen > 0 || normalizedBreakdown.samuel > 0;
    if (!hasBreakdown) return fallback;

    const bucket = enforceOwnerBucketByInbox(
      normalizeStoredResponsibleBucket(params.bucket),
      runForDate?.channel?.chatwootInboxId || null,
    ) as ResponsibleBucket;
    const label = String(params.label || "").trim() || responsibleLabel(bucket);
    const messageCount = Math.max(toSafeInt(params.messageCount), normalizedBreakdown[bucket] || 0);
    return {
      bucket,
      label,
      messageCount,
      breakdown: normalizedBreakdown,
    };
  };
  const pendingContextByName = new Map<string, PendingContext>();
  const pendingContextByConversationId = new Map<number, PendingContext>();

  const reportLogFallbackByName = new Map<
    string,
    {
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      conversationIds: number[];
      chatLinks: string[];
      products: string[];
      clientPhase: "inicial" | "intermediario" | "avancado";
      clientPhaseReason: string;
    }
  >();
  const reportFinalizationActorByConversationId = new Map<number, string>();
  const reportFinalizationActorByName = new Map<string, string>();

  for (const draft of reportDrafts) {
    const draftPhase = deriveClientPhaseFromSignals({
      cnpj: draft.cnpj,
      companyName: draft.companyName,
      labels: draft.labels,
      products: draft.products,
      textSignals: [...(draft.gaps || []), ...(draft.attentions || [])],
    });
    const payload = {
      gaps: Array.isArray(draft.gaps) ? draft.gaps : [],
      attentions: Array.isArray(draft.attentions) ? draft.attentions : [],
      contactName: toTitleCaseName(draft.contactName || ""),
      labels: Array.isArray(draft.labels) ? draft.labels : [],
      severity: draft.severity || "info",
      status: draft.status || "aberto",
      conversationIds: Array.isArray(draft.conversationIds) ? draft.conversationIds : [],
      chatLinks: Array.isArray(draft.chatLinks) ? draft.chatLinks : [],
      products: Array.isArray(draft.products) ? draft.products : [],
      clientPhase: draftPhase.phase,
      clientPhaseReason: draftPhase.reason,
      openedAt: draft.openedAt || null,
      closedAt: draft.closedAt || null,
    };

    const byPhoneKey = String(draft.phonePk || "").trim();
    if (byPhoneKey) reportFallbackByPhone.set(byPhoneKey, payload);
    const byNameKey = normalizeMatchKey(payload.contactName);
    if (byNameKey) reportFallbackByName.set(byNameKey, payload);
    for (const conversationId of payload.conversationIds || []) {
      const id = Number(conversationId || 0);
      if (!id) continue;
      const current = reportFallbackByConversationId.get(id) || {
        products: [],
        clientPhase: payload.clientPhase,
        clientPhaseReason: payload.clientPhaseReason,
      };
      reportFallbackByConversationId.set(id, {
        products: Array.from(new Set([...(current.products || []), ...(payload.products || [])])),
        clientPhase: current.clientPhase || payload.clientPhase,
        clientPhaseReason: current.clientPhaseReason || payload.clientPhaseReason,
      });
    }
  }

  for (const log of reportLogs) {
    const name = toTitleCaseName(String(log.contact_name || "").trim());
    const nameKey = normalizeMatchKey(name);
    if (!nameKey) continue;
    const finalizationActor = String(log.finalization_actor || "").trim();
    if (finalizationActor) {
      reportFinalizationActorByName.set(nameKey, finalizationActor);
    }

    const severity = normalizeSeverityText(log.risk_level);
    const summary = String(log.summary || "").trim();
    const improvements = Array.isArray(log.improvements)
      ? log.improvements.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const conversationIds = Array.isArray(log.conversation_ids)
      ? log.conversation_ids.map((item) => Number(item || 0)).filter((id) => id > 0)
      : [];
    if (finalizationActor) {
      for (const conversationId of conversationIds) {
        if (conversationId > 0 && !reportFinalizationActorByConversationId.has(conversationId)) {
          reportFinalizationActorByConversationId.set(conversationId, finalizationActor);
        }
      }
    }
    const chatLinks = Array.isArray(log.chatwoot_links)
      ? log.chatwoot_links.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const gaps = summary && severity === "critical" ? [summary] : [];
    const phaseFromLog = deriveClientPhaseFromSignals({
      cnpj: "",
      companyName: "",
      products: [],
      labels: [],
      textSignals: [summary, ...improvements],
    });
    const waitingOnAgent = Boolean(log.waiting_on_agent);
    const pendingSinceAt = asFiniteNumber(log.pending_since_at);
    const createdAt = parseIsoDate(log.created_at);
    const pendingHours =
      waitingOnAgent && pendingSinceAt && createdAt
        ? Number(((createdAt.getTime() - pendingSinceAt * 1000) / (1000 * 60 * 60)).toFixed(2))
        : null;
    const logLabels = Array.isArray(log.labels)
      ? log.labels.map((label) => String(label || "").trim()).filter(Boolean)
      : [];
    const pendingContext: PendingContext = {
      waitingOnAgent,
      pendingHours: pendingHours !== null && pendingHours >= 0 ? pendingHours : null,
      labels: logLabels,
      source: "name",
    };

    reportLogFallbackByName.set(nameKey, {
      gaps,
      attentions: improvements,
      labels: [],
      severity,
      status: severity === "critical" || severity === "high" ? "atencao" : "aberto",
      conversationIds,
      chatLinks,
      products: [],
      clientPhase: phaseFromLog.phase,
      clientPhaseReason: phaseFromLog.reason,
    });
    pendingContextByName.set(nameKey, pendingContext);
    for (const conversationId of conversationIds) {
      if (!conversationId) continue;
      pendingContextByConversationId.set(conversationId, {
        ...pendingContext,
        source: "conversation",
      });
    }
  }

  const analysisFallbackByConversationId = new Map<
    number,
    {
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      chatLinks: string[];
      products: string[];
      clientPhase: "inicial" | "intermediario" | "avancado";
      clientPhaseReason: string;
    }
  >();
  const analysisFallbackByName = new Map<
    string,
    {
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      chatLinks: string[];
      products: string[];
      clientPhase: "inicial" | "intermediario" | "avancado";
      clientPhaseReason: string;
    }
  >();
  const analysisFallbackByPhone = new Map<
    string,
    {
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      chatLinks: string[];
      products: string[];
      clientPhase: "inicial" | "intermediario" | "avancado";
      clientPhaseReason: string;
    }
  >();

  const severityPriority = (value: string): number => {
    const key = String(value || "info").toLowerCase();
    return insightSeverityRank[key] || 0;
  };

  const mergedSeverity = (current: string, incoming: string): string =>
    severityPriority(incoming) > severityPriority(current) ? incoming : current;

  const mergeStatus = (current: string, incoming: string): string => {
    const c = String(current || "").toLowerCase();
    const i = String(incoming || "").toLowerCase();
    if (c === "atencao" || i === "atencao") return "atencao";
    if (c === "aberto" || i === "aberto") return "aberto";
    if (c === "resolvido" || i === "resolvido") return "resolvido";
    return current || incoming || "aberto";
  };

  const mergeAnalysisPayload = (
    map: Map<
      string,
      {
        gaps: string[];
        attentions: string[];
        labels: string[];
        severity: string;
        status: string;
        chatLinks: string[];
        products: string[];
        clientPhase: "inicial" | "intermediario" | "avancado";
        clientPhaseReason: string;
      }
    >,
    key: string,
    payload: {
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      chatLinks: string[];
      products: string[];
      clientPhase: "inicial" | "intermediario" | "avancado";
      clientPhaseReason: string;
    },
  ) => {
    if (!key) return;
    const current = map.get(key);
    if (!current) {
      map.set(key, payload);
      return;
    }
    map.set(key, {
      gaps: Array.from(new Set([...current.gaps, ...payload.gaps])),
      attentions: Array.from(new Set([...current.attentions, ...payload.attentions])),
      labels: Array.from(new Set([...current.labels, ...payload.labels])),
      severity: mergedSeverity(current.severity, payload.severity),
      status: mergeStatus(current.status, payload.status),
      chatLinks: Array.from(new Set([...current.chatLinks, ...payload.chatLinks])),
      products: Array.from(new Set([...(current.products || []), ...(payload.products || [])])),
      clientPhase: current.clientPhase || payload.clientPhase,
      clientPhaseReason: current.clientPhaseReason || payload.clientPhaseReason,
    });
  };

  if (runForDate?.id) {
    const analysesFromTables = await safeQuery(
      "conversationAnalysis.findMany",
      () =>
        prisma.conversationAnalysis.findMany({
          where: { runId: runForDate.id },
          select: {
            riskLevel: true,
            summary: true,
            finalizationStatus: true,
            improvementsJson: true,
            aiRawJson: true,
            gaps: {
              select: {
                name: true,
                description: true,
                severity: true,
                isCritical: true,
              },
            },
            insights: {
              select: {
                title: true,
                summary: true,
                severity: true,
              },
            },
            conversation: {
              select: {
                chatwootConversationId: true,
                labels: true,
                resolvedAt: true,
                status: true,
              },
            },
            contact: {
              select: {
                name: true,
                identifierHash: true,
                identifierLast4: true,
                chatwootContactId: true,
              },
            },
          },
        }),
      [] as Array<{
        riskLevel: string | null;
        summary: string | null;
        finalizationStatus: string | null;
        improvementsJson: unknown;
        aiRawJson: unknown;
        gaps: Array<{ name: string | null; description: string | null; severity: string | null; isCritical: boolean | null }>;
        insights: Array<{ title: string | null; summary: string | null; severity: string | null }>;
        conversation: {
          chatwootConversationId: number | null;
          labels: string[] | null;
          resolvedAt: Date | null;
          status: string | null;
        } | null;
        contact: {
          name: string | null;
          identifierHash: string | null;
          identifierLast4: string | null;
          chatwootContactId: number | null;
        } | null;
      }>,
    );

    for (const analysis of analysesFromTables) {
      const conversationId = Number(analysis.conversation?.chatwootConversationId || 0);
      if (!conversationId) continue;

      const gaps = new Set<string>();
      const attentions = new Set<string>();
      const products = new Set<string>();
      const labels = new Set<string>(analysis.conversation?.labels || []);
      let severity = "info";
      let status = "aberto";

      if (analysis.finalizationStatus === "finalizada" || analysis.conversation?.resolvedAt || analysis.conversation?.status === "resolved") {
        status = "resolvido";
      }

      severity = normalizeSeverityText(analysis.riskLevel);

      const summary = String(analysis.summary || "").trim();
      if (summary && severity === "critical") gaps.add(summary);

      const improvements = Array.isArray(analysis.improvementsJson)
        ? analysis.improvementsJson.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      for (const item of improvements) attentions.add(item);

      for (const gap of analysis.gaps || []) {
        const text = String(gap.description || gap.name || "").trim();
        if (text) gaps.add(text);
        const gapSeverity = String(gap.severity || "").toLowerCase();
        if (gap.isCritical) {
          severity = "critical";
        } else if (gapSeverity === "alta" && severity !== "critical") {
          severity = "high";
        } else if (gapSeverity === "media" && severity !== "critical" && severity !== "high") {
          severity = "medium";
        } else if (gapSeverity === "baixa" && severity === "info") {
          severity = "low";
        }
      }

      for (const insight of analysis.insights || []) {
        const text = String(insight.summary || insight.title || "").trim();
        if (text) attentions.add(text);
        const insightSeverity = normalizeSeverityText(insight.severity);
        if (insightSeverity === "critical") {
          severity = "critical";
        } else if (insightSeverity === "high" && severity !== "critical") {
          severity = "high";
        } else if (
          insightSeverity === "medium" &&
          severity !== "critical" &&
          severity !== "high"
        ) {
          severity = "medium";
        } else if (insightSeverity === "low" && severity === "info") {
          severity = "low";
        }
      }

      const aiRaw = asRecord(analysis.aiRawJson);
      const rawProducts = Array.isArray(aiRaw.produtos_citados) ? aiRaw.produtos_citados : [];
      for (const rawProduct of rawProducts) {
        const productObj = asRecord(rawProduct);
        const productNameRaw = pickFirstText(productObj, ["nome_produto", "termo_detectado"]);
        const normalizedProduct = String(productNameRaw || "")
          .replace(/[_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const displayProduct = toTitleCaseName(normalizedProduct);
        if (displayProduct) products.add(displayProduct);
      }

      const explicitPhase = pickFirstText(aiRaw, [
        "fase_cliente",
        "perfil_cliente",
        "tipo_cliente",
        "classificacao_cliente",
        "customer_phase",
      ]);
      const explicitPhaseReason = pickFirstText(aiRaw, [
        "fase_cliente_motivo",
        "perfil_cliente_motivo",
        "justificativa_fase_cliente",
        "customer_phase_reason",
      ]);
      const phaseSignalsFromContext = Array.isArray(aiRaw.contexto_informativo)
        ? aiRaw.contexto_informativo.map((item) => String(item || ""))
        : [];
      const phase = deriveClientPhaseFromSignals({
        explicitPhase,
        explicitReason: explicitPhaseReason,
        cnpj: "",
        companyName: "",
        products: Array.from(products),
        labels: Array.from(labels),
        textSignals: [summary, ...improvements, ...Array.from(gaps), ...Array.from(attentions), ...phaseSignalsFromContext],
      });

      const link = buildConversationLink(
        toChatwootAppBase("https://chat.iainfinity.com.br"),
        Number(contextRun.channel.chatwootAccountId || 0),
        Number(contextRun.channel.chatwootInboxId || 0),
        conversationId,
      );

      const payload = {
        gaps: Array.from(gaps),
        attentions: Array.from(attentions),
        labels: Array.from(labels),
        severity,
        status,
        chatLinks: link ? [link] : [],
        products: Array.from(products),
        clientPhase: phase.phase,
        clientPhaseReason: phase.reason,
      };

      analysisFallbackByConversationId.set(conversationId, payload);

      const nameKey = normalizeMatchKey(String(analysis.contact?.name || "").trim());
      mergeAnalysisPayload(analysisFallbackByName, nameKey, payload);

      const identifierRaw = String(analysis.contact?.identifierHash || "").trim();
      const digits = identifierRaw.replace(/\D+/g, "");
      const phonePk =
        digits.length >= 10
          ? digits
          : analysis.contact?.identifierLast4
            ? `contato-${analysis.contact.chatwootContactId || "sem-id"}-${analysis.contact.identifierLast4}`
            : "";
      if (phonePk) {
        mergeAnalysisPayload(analysisFallbackByPhone, phonePk, payload);
      }
    }
  }

  const pickPendingContext = (name: string, conversationIds: number[]): PendingContext | null => {
    const byConversation = (conversationIds || [])
      .map((id) => pendingContextByConversationId.get(Number(id || 0)) || null)
      .filter((item): item is PendingContext => Boolean(item));
    if (byConversation.length > 0) {
      return byConversation
        .slice()
        .sort((a, b) => Number(b.pendingHours || -1) - Number(a.pendingHours || -1))[0];
    }
    return pendingContextByName.get(normalizeMatchKey(name)) || null;
  };

  const recordsFromRun = (runForDate?.clientRecords || []).map((item) => {
    const fallback =
      reportFallbackByPhone.get(String(item.phonePk || "").trim()) ||
      reportFallbackByName.get(normalizeMatchKey(item.contactName || ""));
    const analysisFallbackByPhoneHit = analysisFallbackByPhone.get(String(item.phonePk || "").trim());
    const analysisFallbackByNameHit = analysisFallbackByName.get(
      normalizeMatchKey(String(item.contactName || fallback?.contactName || "")),
    );
    const logFallback = reportLogFallbackByName.get(
      normalizeMatchKey(String(item.contactName || fallback?.contactName || "")),
    );
    const gapsFromRecord = Array.isArray(item.gapsJson)
      ? item.gapsJson.map((gap) => String(gap || "").trim()).filter(Boolean)
      : [];
    const attentionsFromRecord = Array.isArray(item.attentionsJson)
      ? item.attentionsJson.map((attention) => String(attention || "").trim()).filter(Boolean)
      : [];
    const labelsFromRecord = Array.isArray(item.labels) ? item.labels.filter(Boolean) : [];
    const conversationIdsFromRecord = Array.isArray(item.conversationIds) ? item.conversationIds.filter(Boolean) : [];
    const chatLinksFromRecord = Array.isArray(item.chatLinks) ? item.chatLinks.filter(Boolean) : [];
    const conversationFallbackRows = conversationIdsFromRecord
      .map((conversationId) => {
        const id = Number(conversationId || 0);
        if (!id) return null;
        const fromAnalysis = analysisFallbackByConversationId.get(id);
        const fromReport = reportFallbackByConversationId.get(id);
        if (!fromAnalysis && !fromReport) return null;
        return {
          gaps: fromAnalysis?.gaps || [],
          attentions: fromAnalysis?.attentions || [],
          labels: fromAnalysis?.labels || [],
          severity: fromAnalysis?.severity || "info",
          status: fromAnalysis?.status || "aberto",
          chatLinks: fromAnalysis?.chatLinks || [],
          products: fromAnalysis?.products?.length ? fromAnalysis.products : fromReport?.products || [],
          clientPhase: fromAnalysis?.clientPhase || fromReport?.clientPhase || "inicial",
          clientPhaseReason:
            fromAnalysis?.clientPhaseReason ||
            fromReport?.clientPhaseReason ||
            "Sem evidências de estrutura formal ativa; classificado como fase inicial por padrão.",
        };
      })
      .filter(Boolean) as Array<{
      gaps: string[];
      attentions: string[];
      labels: string[];
      severity: string;
      status: string;
      chatLinks: string[];
      products: string[];
      clientPhase: "inicial" | "intermediario" | "avancado";
      clientPhaseReason: string;
    }>;
    const conversationFallback = {
      gaps: Array.from(new Set(conversationFallbackRows.flatMap((row) => row.gaps))),
      attentions: Array.from(new Set(conversationFallbackRows.flatMap((row) => row.attentions))),
      labels: Array.from(new Set(conversationFallbackRows.flatMap((row) => row.labels))),
      severities: conversationFallbackRows.map((row) => row.severity),
      statuses: conversationFallbackRows.map((row) => row.status),
      chatLinks: Array.from(new Set(conversationFallbackRows.flatMap((row) => row.chatLinks))),
      products: Array.from(new Set(conversationFallbackRows.flatMap((row) => row.products || []))),
      phases: conversationFallbackRows.map((row) => row.clientPhase),
      phaseReasons: conversationFallbackRows.map((row) => row.clientPhaseReason),
    };
    // Regra principal: status/severidade devem refletir exatamente o resultado persistido da IA
    // para a execução selecionada. Fallback só entra quando esse dado estiver ausente.
    const normalizedItemSeverity = String(item.severity || "").trim().toLowerCase();
    const hasAuthoritativeSeverity =
      normalizedItemSeverity === "critical" ||
      normalizedItemSeverity === "high" ||
      normalizedItemSeverity === "medium" ||
      normalizedItemSeverity === "low" ||
      normalizedItemSeverity === "info";
    const unifiedSeverity = (
      hasAuthoritativeSeverity
        ? item.severity
        : [
            fallback?.severity,
            analysisFallbackByPhoneHit?.severity,
            analysisFallbackByNameHit?.severity,
            logFallback?.severity,
            ...conversationFallback.severities,
          ]
            .filter(Boolean)
            .reduce((best, current) => mergedSeverity(best, current), "info")
    ) as typeof item.severity;

    const normalizedItemStatus = String(item.status || "").trim().toLowerCase();
    const hasAuthoritativeStatus =
      normalizedItemStatus === "aberto" ||
      normalizedItemStatus === "atencao" ||
      normalizedItemStatus === "resolvido";
    const unifiedStatus = hasAuthoritativeStatus
      ? item.status
      : [
          fallback?.status,
          analysisFallbackByPhoneHit?.status,
          analysisFallbackByNameHit?.status,
          logFallback?.status,
          ...conversationFallback.statuses,
        ]
          .filter(Boolean)
          .reduce((best, current) => mergeStatus(best, current), "aberto");

    const phaseCandidates = [
      fallback?.clientPhase,
      analysisFallbackByPhoneHit?.clientPhase,
      analysisFallbackByNameHit?.clientPhase,
      logFallback?.clientPhase,
      ...conversationFallback.phases,
    ];
    const phaseReasonCandidates = [
      fallback?.clientPhaseReason,
      analysisFallbackByPhoneHit?.clientPhaseReason,
      analysisFallbackByNameHit?.clientPhaseReason,
      logFallback?.clientPhaseReason,
      ...conversationFallback.phaseReasons,
    ];
    const inferredPhase = deriveClientPhaseFromSignals({
      explicitPhase: phaseCandidates.find(Boolean) || null,
      explicitReason: phaseReasonCandidates.find(Boolean) || null,
      cnpj: item.cnpj || "",
      companyName: item.companyName || "",
      products: firstNonEmptyStringArray(
        fallback?.products,
        analysisFallbackByPhoneHit?.products,
        analysisFallbackByNameHit?.products,
        logFallback?.products,
        conversationFallback.products,
      ),
      labels:
        labelsFromRecord.length > 0
          ? labelsFromRecord
          : fallback?.labels ||
            analysisFallbackByPhoneHit?.labels ||
            analysisFallbackByNameHit?.labels ||
            logFallback?.labels ||
            conversationFallback.labels ||
            [],
      textSignals: [
        ...(gapsFromRecord.length > 0
          ? gapsFromRecord
          : fallback?.gaps ||
            analysisFallbackByPhoneHit?.gaps ||
            analysisFallbackByNameHit?.gaps ||
            logFallback?.gaps ||
            conversationFallback.gaps ||
            []),
        ...(attentionsFromRecord.length > 0
          ? attentionsFromRecord
          : fallback?.attentions ||
            analysisFallbackByPhoneHit?.attentions ||
            analysisFallbackByNameHit?.attentions ||
            logFallback?.attentions ||
            conversationFallback.attentions ||
            []),
      ],
    });
    const unifiedGaps =
      gapsFromRecord.length > 0
        ? gapsFromRecord
        : fallback?.gaps ||
          analysisFallbackByPhoneHit?.gaps ||
          analysisFallbackByNameHit?.gaps ||
          logFallback?.gaps ||
          conversationFallback.gaps ||
          [];
    const unifiedAttentions =
      attentionsFromRecord.length > 0
        ? attentionsFromRecord
        : fallback?.attentions ||
          analysisFallbackByPhoneHit?.attentions ||
          analysisFallbackByNameHit?.attentions ||
          logFallback?.attentions ||
          conversationFallback.attentions ||
          [];
    const unifiedLabels =
      labelsFromRecord.length > 0
        ? labelsFromRecord
        : fallback?.labels ||
          analysisFallbackByPhoneHit?.labels ||
          analysisFallbackByNameHit?.labels ||
          logFallback?.labels ||
          conversationFallback.labels ||
          [];
    const resolvedConversationIds =
      conversationIdsFromRecord.length > 0
        ? conversationIdsFromRecord
        : fallback?.conversationIds || logFallback?.conversationIds || [];
    const resolvedContactName = toTitleCaseName(item.contactName || fallback?.contactName || "");
    const finalizationActor =
      resolvedConversationIds
        .map((conversationId) => reportFinalizationActorByConversationId.get(Number(conversationId || 0)) || "")
        .find(Boolean) ||
      reportFinalizationActorByName.get(normalizeMatchKey(resolvedContactName)) ||
      null;
    const pendingContext = pickPendingContext(resolvedContactName, resolvedConversationIds);
    const classification = classifyPipelineBlock({
      status: unifiedStatus,
      severity: unifiedSeverity,
      labels: unifiedLabels,
      gaps: unifiedGaps,
      attentions: unifiedAttentions,
      pendingContext,
    });
    const responsibleTracking = buildResponsibleTrackingFromStored({
      bucket: (item as { responsibleBucket?: unknown }).responsibleBucket,
      label: (item as { responsibleLabel?: unknown }).responsibleLabel,
      messageCount: (item as { responsibleMessageCount?: unknown }).responsibleMessageCount,
      breakdown: (item as { responsibleMessageBreakdown?: unknown }).responsibleMessageBreakdown,
      conversationIds: resolvedConversationIds,
    });

    return {
    lifecycle: (() => {
      const state = stateByPhone.get(item.phonePk);
      if (!state) return null;
      return {
        firstSeenAt: state.firstSeenAt.toISOString(),
        lastSeenAt: state.lastSeenAt.toISOString(),
        firstIssueAt: state.firstIssueAt ? state.firstIssueAt.toISOString() : null,
        lastIssueAt: state.lastIssueAt ? state.lastIssueAt.toISOString() : null,
        resolvedAt: state.resolvedAt ? state.resolvedAt.toISOString() : null,
        currentStatus: state.currentStatus,
        currentSeverity: state.currentSeverity,
      };
    })(),
    timeline: timelineByPhone.get(item.phonePk) || [],
    phonePk: item.phonePk,
    contactName: resolvedContactName,
    finalizationActor,
    companyName: item.companyName || "",
    cnpj: item.cnpj || "",
    gaps: unifiedGaps,
    attentions: unifiedAttentions,
    labels: unifiedLabels,
    products: normalizeClientProductList(firstNonEmptyStringArray(
      fallback?.products,
      analysisFallbackByPhoneHit?.products,
      analysisFallbackByNameHit?.products,
      logFallback?.products,
      conversationFallback.products,
    )),
    clientPhase: inferredPhase.phase,
    clientPhaseReason: inferredPhase.reason,
    conversationIds: resolvedConversationIds,
    chatLinks:
      chatLinksFromRecord.length > 0
        ? chatLinksFromRecord
        : fallback?.chatLinks ||
          analysisFallbackByPhoneHit?.chatLinks ||
          analysisFallbackByNameHit?.chatLinks ||
          logFallback?.chatLinks ||
          conversationFallback.chatLinks ||
          [],
    openedAt: item.openedAt ? item.openedAt.toISOString() : null,
    closedAt: item.closedAt ? item.closedAt.toISOString() : null,
    status: unifiedStatus,
    severity: unifiedSeverity,
    responsibleBucket: responsibleTracking.bucket,
    responsibleLabel: responsibleTracking.label,
    responsibleMessageCount: responsibleTracking.messageCount,
    responsibleMessageBreakdown: responsibleTracking.breakdown,
    pipelineBlock: classification.pipelineBlock,
    remarketing: classification.remarketing,
  };
  });

  if (recordsFromRun.length > 0) {
    return {
      date: runForDate?.dateRef.toISOString().slice(0, 10) || date,
      runId: runForDate?.id || null,
      generatedAt: runForDate?.startedAt.toISOString() || null,
      source: "client_records",
      items: recordsFromRun,
    };
  }

  if (reportDrafts.length > 0) {
    return {
      date: runForDate?.dateRef.toISOString().slice(0, 10) || date,
      runId: runForDate?.id || contextRun.id,
      generatedAt: runForDate?.startedAt.toISOString() || contextRun.startedAt.toISOString(),
      source: "report_fallback",
      items: reportDrafts.map((draft) => {
        const state = stateByPhone.get(draft.phonePk);
        const phase = deriveClientPhaseFromSignals({
          cnpj: draft.cnpj,
          companyName: draft.companyName,
          products: draft.products || [],
          labels: draft.labels || [],
          textSignals: [...(draft.gaps || []), ...(draft.attentions || [])],
        });
        const pendingContext = pickPendingContext(String(draft.contactName || ""), draft.conversationIds || []);
        const finalizationActor =
          (draft.conversationIds || [])
            .map((conversationId) => reportFinalizationActorByConversationId.get(Number(conversationId || 0)) || "")
            .find(Boolean) ||
          reportFinalizationActorByName.get(normalizeMatchKey(String(draft.contactName || ""))) ||
          null;
        const classification = classifyPipelineBlock({
          status: draft.status || "aberto",
          severity: draft.severity || "info",
          labels: draft.labels || [],
          gaps: draft.gaps || [],
          attentions: draft.attentions || [],
          pendingContext,
        });
        const responsibleTracking = buildResponsibleTracking(draft.conversationIds || []);
        return {
          lifecycle: state
            ? {
                firstSeenAt: state.firstSeenAt.toISOString(),
                lastSeenAt: state.lastSeenAt.toISOString(),
                firstIssueAt: state.firstIssueAt ? state.firstIssueAt.toISOString() : null,
                lastIssueAt: state.lastIssueAt ? state.lastIssueAt.toISOString() : null,
                resolvedAt: state.resolvedAt ? state.resolvedAt.toISOString() : null,
                currentStatus: state.currentStatus,
                currentSeverity: state.currentSeverity,
              }
            : null,
          timeline: timelineByPhone.get(draft.phonePk) || [],
          phonePk: draft.phonePk,
          contactName: toTitleCaseName(draft.contactName || ""),
          finalizationActor,
          companyName: draft.companyName || "",
          cnpj: draft.cnpj || "",
          gaps: draft.gaps || [],
          attentions: draft.attentions || [],
          labels: draft.labels || [],
          products: normalizeClientProductList(draft.products || []),
          conversationIds: draft.conversationIds || [],
          chatLinks: draft.chatLinks || [],
          openedAt: draft.openedAt ? draft.openedAt.toISOString() : null,
          closedAt: draft.closedAt ? draft.closedAt.toISOString() : null,
          status: draft.status || "aberto",
          severity: draft.severity || "info",
          responsibleBucket: responsibleTracking.bucket,
          responsibleLabel: responsibleTracking.label,
          responsibleMessageCount: responsibleTracking.messageCount,
          responsibleMessageBreakdown: responsibleTracking.breakdown,
          clientPhase: phase.phase,
          clientPhaseReason: phase.reason,
          pipelineBlock: classification.pipelineBlock,
          remarketing: classification.remarketing,
        };
      }),
    };
  }

  const statesFallback = await safeQuery(
    "clientState fallback findMany",
    () =>
      prisma.clientState.findMany({
        where: {
          tenantId: contextRun.tenantId,
          channelId: contextRun.channelId,
        },
        orderBy: { updatedAt: "desc" },
        take: 500,
      }),
    [] as Array<{
      phonePk: string;
      contactName: string | null;
      companyName: string | null;
      cnpj: string | null;
      currentLabels: string[] | null;
      openConversationIds: number[] | null;
      firstSeenAt: Date;
      lastSeenAt: Date | null;
      firstIssueAt: Date | null;
      lastIssueAt: Date | null;
      resolvedAt: Date | null;
      currentStatus: string;
      currentSeverity: string;
      responsibleBucket: string | null;
      responsibleLabel: string | null;
      responsibleMessageCount: number | null;
      responsibleMessageBreakdown: unknown;
    }>,
  );

  if (statesFallback.length > 0) {
    return {
      date: runForDate?.dateRef.toISOString().slice(0, 10) || date,
      runId: runForDate?.id || contextRun.id,
      generatedAt: runForDate?.startedAt.toISOString() || contextRun.startedAt.toISOString(),
      source: "client_states",
      items: statesFallback.map((state) => {
        const phase = deriveClientPhaseFromSignals({
          cnpj: state.cnpj,
          companyName: state.companyName,
          products: [],
          labels: state.currentLabels || [],
          textSignals: [],
        });
        const pendingContext = pickPendingContext(String(state.contactName || ""), state.openConversationIds || []);
        const classification = classifyPipelineBlock({
          status: state.currentStatus,
          severity: state.currentSeverity,
          labels: state.currentLabels || [],
          gaps: [],
          attentions: [],
          pendingContext,
        });
        const responsibleTracking = buildResponsibleTrackingFromStored({
          bucket: (state as { responsibleBucket?: unknown }).responsibleBucket,
          label: (state as { responsibleLabel?: unknown }).responsibleLabel,
          messageCount: (state as { responsibleMessageCount?: unknown }).responsibleMessageCount,
          breakdown: (state as { responsibleMessageBreakdown?: unknown }).responsibleMessageBreakdown,
          conversationIds: state.openConversationIds || [],
        });
        return {
        clientPhase: phase.phase,
        clientPhaseReason: phase.reason,
        lifecycle: {
          firstSeenAt: state.firstSeenAt.toISOString(),
          lastSeenAt: state.lastSeenAt.toISOString(),
          firstIssueAt: state.firstIssueAt ? state.firstIssueAt.toISOString() : null,
          lastIssueAt: state.lastIssueAt ? state.lastIssueAt.toISOString() : null,
          resolvedAt: state.resolvedAt ? state.resolvedAt.toISOString() : null,
          currentStatus: state.currentStatus,
          currentSeverity: state.currentSeverity,
        },
        timeline: timelineByPhone.get(state.phonePk) || [],
        phonePk: state.phonePk,
        contactName: toTitleCaseName(state.contactName || ""),
        finalizationActor: null,
        companyName: state.companyName || "",
        cnpj: state.cnpj || "",
        gaps: [],
        attentions: [],
        labels: state.currentLabels || [],
        products: normalizeClientProductList([]),
        conversationIds: state.openConversationIds || [],
        chatLinks: (state.openConversationIds || [])
          .map((conversationId) =>
            buildConversationLink(
              toChatwootAppBase("https://chat.iainfinity.com.br"),
              Number(contextRun.channel.chatwootAccountId || 0),
              Number(contextRun.channel.chatwootInboxId || 0),
              Number(conversationId || 0),
            ),
          )
          .filter((link): link is string => Boolean(link)),
        openedAt: state.firstSeenAt ? state.firstSeenAt.toISOString() : null,
        closedAt: state.resolvedAt ? state.resolvedAt.toISOString() : null,
        status: state.currentStatus,
        severity: state.currentSeverity,
        responsibleBucket: responsibleTracking.bucket,
        responsibleLabel: responsibleTracking.label,
        responsibleMessageCount: responsibleTracking.messageCount,
        responsibleMessageBreakdown: responsibleTracking.breakdown,
        pipelineBlock: classification.pipelineBlock,
        remarketing: classification.remarketing,
      };
      }),
    };
  }

  const contacts = await safeQuery(
    "contact.findMany",
    () =>
      prisma.contact.findMany({
        where: {
          tenantId: contextRun.tenantId,
          conversations: {
            some: {
              channelId: contextRun.channelId,
            },
          },
        },
        select: {
          name: true,
          chatwootContactId: true,
          identifierHash: true,
          identifierLast4: true,
          conversations: {
            where: {
              channelId: contextRun.channelId,
            },
            select: {
              chatwootConversationId: true,
              labels: true,
              createdAt: true,
              resolvedAt: true,
              lastActivityAt: true,
              status: true,
            },
          },
        },
        take: 500,
        orderBy: { updatedAt: "desc" },
      }),
    [] as Array<{
      name: string | null;
      chatwootContactId: number | null;
      identifierHash: string | null;
      identifierLast4: string | null;
      conversations: Array<{
        chatwootConversationId: number | null;
        labels: string[] | null;
        createdAt: Date;
        resolvedAt: Date | null;
        lastActivityAt: Date | null;
        status: string | null;
      }>;
    }>,
  );

  const contactItems = contacts.map((contact) => {
    const identifierRaw = String(contact.identifierHash || "").trim();
    const digits = identifierRaw.replace(/\D+/g, "");
    const phonePk =
      digits.length >= 10
        ? digits
        : contact.identifierLast4
          ? `contato-${contact.chatwootContactId || "sem-id"}-${contact.identifierLast4}`
          : `contato-${contact.chatwootContactId || "sem-id"}`;

    const conversationIds = contact.conversations
      .map((conversation) => Number(conversation.chatwootConversationId || 0))
      .filter((id) => id > 0);
    const labels = Array.from(new Set(contact.conversations.flatMap((conversation) => conversation.labels || []).filter(Boolean)));
    const createdDates = contact.conversations.map((conversation) => conversation.createdAt).filter(Boolean);
    const resolvedDates = contact.conversations.map((conversation) => conversation.resolvedAt).filter(Boolean);
    const openedAt = createdDates.length > 0 ? new Date(Math.min(...createdDates.map((item) => item.getTime()))) : null;
    const closedAt = resolvedDates.length > 0 ? new Date(Math.max(...resolvedDates.map((item) => item.getTime()))) : null;
    const status = closedAt ? "resolvido" : "aberto";
    const phase = deriveClientPhaseFromSignals({
      cnpj: "",
      companyName: "",
      products: [],
      labels,
      textSignals: [],
    });
    const pendingContext = pickPendingContext(String(contact.name || ""), conversationIds);
    const classification = classifyPipelineBlock({
      status,
      severity: "info",
      labels,
      gaps: [],
      attentions: [],
      pendingContext,
    });
    const responsibleTracking = buildResponsibleTracking(conversationIds);

    return {
      lifecycle: null,
      timeline: timelineByPhone.get(phonePk) || [],
      phonePk,
      contactName: toTitleCaseName(String(contact.name || "").trim()),
      finalizationActor: null,
      companyName: "",
      cnpj: "",
      gaps: [],
      attentions: [],
      labels,
      products: normalizeClientProductList([]),
      conversationIds,
      chatLinks: conversationIds
        .map((conversationId) =>
          buildConversationLink(
            toChatwootAppBase("https://chat.iainfinity.com.br"),
            Number(contextRun.channel.chatwootAccountId || 0),
            Number(contextRun.channel.chatwootInboxId || 0),
            Number(conversationId || 0),
          ),
        )
        .filter((link): link is string => Boolean(link)),
      openedAt: openedAt ? openedAt.toISOString() : null,
      closedAt: closedAt ? closedAt.toISOString() : null,
      status,
      severity: "info",
      responsibleBucket: responsibleTracking.bucket,
      responsibleLabel: responsibleTracking.label,
      responsibleMessageCount: responsibleTracking.messageCount,
      responsibleMessageBreakdown: responsibleTracking.breakdown,
      clientPhase: phase.phase,
      clientPhaseReason: phase.reason,
      pipelineBlock: classification.pipelineBlock,
      remarketing: classification.remarketing,
    };
  });

  return {
    date: runForDate?.dateRef.toISOString().slice(0, 10) || date,
    runId: runForDate?.id || contextRun.id,
    generatedAt: runForDate?.startedAt.toISOString() || contextRun.startedAt.toISOString(),
    source: "contacts_fallback",
    items: contactItems,
  };
}
