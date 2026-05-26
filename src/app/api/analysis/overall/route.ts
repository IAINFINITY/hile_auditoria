import { RunStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import type { Severity } from "@/types";
import { prisma } from "@/lib/db/prisma";
import { requireAuthorizedApiAccess } from "@/lib/server/apiUtils";

export const runtime = "nodejs";

function normalizeOwnerScope(value: string | null): "all" | "ia" | "suellen" | "samuel" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ia" || normalized === "suellen" || normalized === "samuel") return normalized;
  return "all";
}

function normalizeSeverity(value: unknown): Severity {
  const text = String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
  if (!text) return "info";
  if (/\bnon critical\b/.test(text)) return "info";
  if (/\bcritical\b|\bcritico\b|\bcrit\b/.test(text)) return "critical";
  if (/\bhigh\b|\balto\b/.test(text)) return "high";
  if (/\bmedium\b|\bmedio\b/.test(text)) return "medium";
  if (/\blow\b|\bbaixo\b/.test(text)) return "low";
  return "info";
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseHour(value: unknown): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const fromDate = new Date(raw);
  if (!Number.isNaN(fromDate.getTime())) {
    const hour = fromDate.getHours();
    return hour >= 0 && hour <= 23 ? hour : null;
  }
  const hhmm = raw.match(/(\d{1,2}):(\d{2})/);
  if (!hhmm) return null;
  const hour = Number(hhmm[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return hour;
}

function parseHourlyRolesFromLogText(logText: unknown): Array<{ hour: number; role: "USER" | "AGENT" }> {
  const lines = String(logText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed: Array<{ hour: number; role: "USER" | "AGENT" }> = [];

  for (const line of lines) {
    const upper = line.toUpperCase();
    let role: "USER" | "AGENT" | null = null;
    if (/\b(AGENT|ASSISTANT|ATENDENTE|BOT|AI|IA|ACESSO_INFINITY|ACESSO INFINITY)\b/.test(upper)) {
      role = "AGENT";
    } else if (/\b(USER|USUARIO|USUÁRIO|CLIENTE|CONTACT)\b/.test(upper)) {
      role = "USER";
    }
    if (!role || upper.includes("SYSTEM_PRIVATE")) continue;

    const tsMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/);
    let hour: number | null = null;
    if (tsMatch?.[1]) {
      hour = parseHour(tsMatch[1]);
    } else {
      const shortHourMatch = line.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
      if (shortHourMatch?.[0]) hour = parseHour(shortHourMatch[0]);
      if (hour === null) {
        const brDateTimeMatch = line.match(/\b(\d{2})\/(\d{2})\/(\d{4}),\s*([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
        if (brDateTimeMatch) {
          const [, d, m, y, hh, mm, ss] = brDateTimeMatch;
          const localDate = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss || 0));
          hour = parseHour(localDate.toISOString());
        }
      }
    }
    if (hour === null) continue;
    parsed.push({ hour, role });
  }

  return parsed;
}

function extractOverviewRecord(reportJson: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!reportJson || typeof reportJson !== "object") return null;
  const direct = reportJson.overview;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    const record = direct as Record<string, unknown>;
    const nested = record.overview;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
    return record;
  }
  return null;
}

function normalizeFinalizationStatus(value: unknown): "finalizada" | "continuada" | null {
  const text = String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!text) return null;
  if (text.includes("finalizada") || text.includes("resolvida") || text.includes("resolved")) return "finalizada";
  if (text.includes("continuada") || text.includes("aberta") || text.includes("open") || text.includes("pending")) {
    return "continuada";
  }
  return null;
}

const severityWeight: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function maxSeverityFromParsedAnswer(parsed: Record<string, unknown> | null): Severity {
  if (!parsed) return "info";

  const topLevel = normalizeSeverity(
    parsed.severidade ?? parsed.severity ?? parsed.nivel_risco ?? parsed.risco ?? parsed.severity_current ?? null,
  );
  let current: Severity = topLevel;

  const gaps = Array.isArray(parsed.gaps_operacionais) ? parsed.gaps_operacionais : [];
  for (const gap of gaps) {
    if (!gap || typeof gap !== "object") continue;
    const row = gap as Record<string, unknown>;
    const gapSeverity = normalizeSeverity(row.severidade ?? row.severity ?? row.nivel ?? row.prioridade ?? null);
    if (severityWeight[gapSeverity] > severityWeight[current]) current = gapSeverity;
  }

  return current;
}

export async function GET(request: Request) {
  try {
    const authResponse = await requireAuthorizedApiAccess();
    if (authResponse) return authResponse;

    const { searchParams } = new URL(request.url);
    const takeInput = Number(searchParams.get("take") || searchParams.get("limit") || 300);
    const pageInput = Number(searchParams.get("page") || 1);
    const ownerScope = normalizeOwnerScope(searchParams.get("owner"));
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
        startedAt: true,
        finishedAt: true,
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
    const hourlyConversations = new Array<number>(24).fill(0);
    const hourlyIa = new Array<number>(24).fill(0);
    const hourlyUsuario = new Array<number>(24).fill(0);
    const latestByContact = new Map<
      string,
      {
        id: string;
        date: string;
        contact_name: string;
        summary: string;
        severity: Severity;
        at_ms: number;
      }
    >();
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
      if (ownerScope === "all") {
        conversationsAnalyzed += Math.max(0, Number(run.processed || 0));
      }

      const reportJson = (run.report?.reportJson as Record<string, unknown> | null) || null;
      const overviewObj = extractOverviewRecord(reportJson);
      const analysisSeverityByContact = new Map<string, Severity>();
      const analysisByContact = new Map<string, Record<string, unknown>>();
      const allowedContactKeys = new Set<string>();
      const rawAnalysis = reportJson?.raw_analysis as Record<string, unknown> | undefined;
      const analyses = Array.isArray(rawAnalysis?.analyses) ? (rawAnalysis?.analyses as unknown[]) : [];
      let runMessagesFromAnalyses = 0;
      let runMessagesFromParsedLogs = 0;
      let runFinalizedFromAnalyses = 0;
      let runContinuedFromAnalyses = 0;
      for (const entry of analyses) {
        if (!entry || typeof entry !== "object") continue;
        const row = entry as Record<string, unknown>;
        const tracking = (row.responsible_tracking as Record<string, unknown> | undefined) || undefined;
        const ownerBucket = String(tracking?.owner_bucket || "ia").toLowerCase();
        if (ownerScope !== "all" && ownerBucket !== ownerScope) continue;
        const key = String(row.contact_key || "").trim();
        if (!key) continue;
        allowedContactKeys.add(key);
        runMessagesFromAnalyses += Math.max(0, Number(row.message_count_day || 0));
        analysisByContact.set(key, row);
        const analysisObj = row.analysis as Record<string, unknown> | undefined;
        const answerParsed = parseJsonRecord(analysisObj?.answer ?? null);
        analysisSeverityByContact.set(key, maxSeverityFromParsedAnswer(answerParsed));

        const parsedRoles = parseHourlyRolesFromLogText(row.log_text ?? "");
        runMessagesFromParsedLogs += parsedRoles.length;
        for (const pair of parsedRoles) {
          if (pair.hour < 0 || pair.hour > 23) continue;
          if (pair.role === "AGENT") hourlyIa[pair.hour] += 1;
          else hourlyUsuario[pair.hour] += 1;
        }

        const operationalRows = Array.isArray(row.conversation_operational)
          ? (row.conversation_operational as unknown[])
          : [];
        for (const op of operationalRows) {
          if (!op || typeof op !== "object") continue;
          const opRecord = op as Record<string, unknown>;
          const state = (opRecord.state || null) as Record<string, unknown> | null;
          const finalization = normalizeFinalizationStatus(state?.finalization_status ?? opRecord.finalization_status ?? null);
          if (finalization === "finalizada") runFinalizedFromAnalyses += 1;
          if (finalization === "continuada") runContinuedFromAnalyses += 1;
          const hour = parseHour(state?.last_interaction_at_local ?? state?.trigger_after_1h_at_local ?? null);
          if (hour === null || hour < 0 || hour > 23) continue;
          hourlyConversations[hour] += 1;
        }
      }
      if (ownerScope !== "all") {
        for (const key of allowedContactKeys) uniqueContacts.add(key);
      }

      const logs = Array.isArray(reportJson?.logs) ? (reportJson?.logs as Array<Record<string, unknown>>) : [];
      let runMessagesFromLogs = 0;
      let runFinalizedFromLogs = 0;
      let runContinuedFromLogs = 0;
      logs.forEach((log, index) => {
        const contactKey = String(log.contact_key || "").trim();
        if (ownerScope !== "all" && contactKey && !allowedContactKeys.has(contactKey)) return;
        if (contactKey) uniqueContacts.add(contactKey);
        runMessagesFromLogs += Math.max(0, Number(log.message_count_day || log.total_messages_day || 0));
        const finalizationStatus = normalizeFinalizationStatus(log.finalization_status ?? log.status_operacional ?? null);
        if (finalizationStatus === "finalizada") runFinalizedFromLogs += 1;
        else if (finalizationStatus === "continuada") runContinuedFromLogs += 1;

        const severity =
          analysisSeverityByContact.get(contactKey) ||
          normalizeSeverity(log.severity_current ?? log.max_severity ?? log.risk_level);
        const summary = String(log.summary || "").trim();
        const analysisEntry = analysisByContact.get(contactKey);
        const atRaw = String(log.updated_at || log.created_at || run.finishedAt?.toISOString() || run.startedAt.toISOString());
        const atMs = new Date(atRaw).getTime();
        const row = {
          id: `${run.id}-${index + 1}`,
          date: dateRef,
          contact_name: String(log.contact_name || log.contact_key || "Contato"),
          summary:
            summary ||
            String((analysisEntry?.analysis as Record<string, unknown> | undefined)?.answer || "").trim() ||
            "Sem resumo estruturado.",
          severity,
          at_ms: Number.isFinite(atMs) ? atMs : run.startedAt.getTime(),
        };
        const previous = latestByContact.get(contactKey);
        if (!previous || row.at_ms >= previous.at_ms) {
          latestByContact.set(contactKey, row);
        }
      });

      const runMessagesFromOverview = Math.max(
        0,
        Number(overviewObj?.total_messages_day ?? overviewObj?.total_messages ?? 0),
      );
      const runFinalizedFromOverview = Math.max(0, Number(overviewObj?.finalized_count ?? 0));
      const runContinuedFromOverview = Math.max(0, Number(overviewObj?.continued_count ?? 0));

      const runMessages =
        ownerScope === "all" && runMessagesFromOverview > 0
          ? runMessagesFromOverview
          : runMessagesFromAnalyses > 0
            ? runMessagesFromAnalyses
            : runMessagesFromParsedLogs > 0
              ? runMessagesFromParsedLogs
              : runMessagesFromLogs;
      totalMessages += runMessages;

      const runFinalized =
        ownerScope === "all" && runFinalizedFromOverview > 0
          ? runFinalizedFromOverview
          : runFinalizedFromLogs > 0
            ? runFinalizedFromLogs
            : runFinalizedFromAnalyses > 0
              ? runFinalizedFromAnalyses
              : 0;
      let runContinued =
        ownerScope === "all" && runContinuedFromOverview > 0
          ? runContinuedFromOverview
          : runContinuedFromLogs > 0
            ? runContinuedFromLogs
            : runContinuedFromAnalyses > 0
              ? runContinuedFromAnalyses
              : Math.max(0, Math.max(0, allowedContactKeys.size) - runFinalized);

      const processedCount =
        ownerScope === "all" ? Math.max(0, Number(run.processed || 0)) : Math.max(0, allowedContactKeys.size);
      if (runFinalized + runContinued > processedCount && processedCount > 0) {
        const overflow = runFinalized + runContinued - processedCount;
        runContinued = Math.max(0, runContinued - overflow);
      }

      if (ownerScope !== "all") {
        conversationsAnalyzed += allowedContactKeys.size;
      }
      finalizedCount += runFinalized;
      continuedCount += runContinued;
    }

    for (const [, latest] of latestByContact) {
      severitySnapshot[latest.severity] += 1;
    }

    const criticalInsights = severitySnapshot.critical;
    const nonCriticalInsights =
      severitySnapshot.high + severitySnapshot.medium + severitySnapshot.low + severitySnapshot.info;
    const trendSeries = hourlyConversations.map((conversas, hour) => ({
      label: `${String(hour).padStart(2, "0")}h`,
      conversas,
      ia: hourlyIa[hour],
      usuario: hourlyUsuario[hour],
    }));

    return NextResponse.json({
      total_runs: runs.length,
      owner_scope: ownerScope,
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
      trend_series: trendSeries,
      context_items: Array.from(latestByContact.values())
        .sort((a, b) => b.at_ms - a.at_ms)
        .slice(0, 200)
        .map(({ id, date, contact_name, summary, severity }) => ({ id, date, contact_name, summary, severity })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Falha ao carregar análise total.";
    return NextResponse.json({ error: "analysis_overall_failed", message }, { status: 400 });
  }
}
