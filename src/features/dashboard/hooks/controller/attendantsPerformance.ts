import type { ReportPayload } from "../../../../types";
import type { AttendantPerformanceSummary } from "../../shared/types";
import { parseJsonObject } from "./common";

export function buildAttendantsPerformance(report: ReportPayload | null): AttendantPerformanceSummary {
  const owners: Array<"ia" | "suellen" | "samuel"> = ["ia", "suellen", "samuel"];
  const fromSummary = report?.summary?.responsible_performance;

  if (fromSummary) {
    const entries = owners.map((owner) => {
      const item = fromSummary[owner];
      return {
        owner,
        ownerLabel: item.owner_label,
        analysesCount: Number(item.analyses_count || 0),
        contactsCount: Number(item.contacts_count || 0),
        conversationsCount: Number(item.conversations_count || 0),
        messageCountAgent: Number(item.message_count_agent || 0),
        gapsCount: Number(item.gaps_count || 0),
        criticalGapsCount: Number(item.critical_gaps_count || 0),
        improvementsCount: Number(item.improvements_count || 0),
        avgResponseSec: item.avg_response_sec ?? null,
        maxResponseSec: item.max_response_sec ?? null,
        responseSamples: Number(item.response_samples || 0),
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

  const analyses = report?.raw_analysis?.analyses || [];
  const bucketMap = {
    ia: {
      owner: "ia" as const,
      ownerLabel: "IA",
      analysesCount: 0,
      contactsCount: 0,
      conversationsCount: 0,
      messageCountAgent: 0,
      gapsCount: 0,
      criticalGapsCount: 0,
      improvementsCount: 0,
      avgResponseSec: null as number | null,
      maxResponseSec: null as number | null,
      responseSamples: 0,
      _sumResponseSec: 0,
      _contacts: new Set<string>(),
      _conversations: new Set<number>(),
    },
    suellen: {
      owner: "suellen" as const,
      ownerLabel: "Comercial Suellen",
      analysesCount: 0,
      contactsCount: 0,
      conversationsCount: 0,
      messageCountAgent: 0,
      gapsCount: 0,
      criticalGapsCount: 0,
      improvementsCount: 0,
      avgResponseSec: null as number | null,
      maxResponseSec: null as number | null,
      responseSamples: 0,
      _sumResponseSec: 0,
      _contacts: new Set<string>(),
      _conversations: new Set<number>(),
    },
    samuel: {
      owner: "samuel" as const,
      ownerLabel: "Comercial Samuel",
      analysesCount: 0,
      contactsCount: 0,
      conversationsCount: 0,
      messageCountAgent: 0,
      gapsCount: 0,
      criticalGapsCount: 0,
      improvementsCount: 0,
      avgResponseSec: null as number | null,
      maxResponseSec: null as number | null,
      responseSamples: 0,
      _sumResponseSec: 0,
      _contacts: new Set<string>(),
      _conversations: new Set<number>(),
    },
  };

  const parseSeverity = (value: unknown): "critical" | "high" | "medium" | "low" | "info" => {
    const normalized = String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (normalized.includes("crit")) return "critical";
    if (normalized.includes("high") || normalized.includes("alt")) return "high";
    if (normalized.includes("medium") || normalized.includes("med")) return "medium";
    if (normalized.includes("low") || normalized.includes("baix")) return "low";
    return "info";
  };

  for (const analysis of analyses) {
    const tracking = analysis.responsible_tracking;
    const owner = tracking?.owner_bucket && owners.includes(tracking.owner_bucket) ? tracking.owner_bucket : "ia";
    const bucket = bucketMap[owner];
    const parsed = parseJsonObject(String(analysis.analysis?.answer || ""));

    bucket.analysesCount += 1;
    bucket.messageCountAgent += Number(tracking?.message_count_agent || 0);
    bucket.improvementsCount += Array.isArray(parsed.pontos_melhoria) ? (parsed.pontos_melhoria as unknown[]).length : 0;

    if (analysis.contact_key) bucket._contacts.add(String(analysis.contact_key));
    for (const conversationId of analysis.conversation_ids || []) {
      const id = Number(conversationId || 0);
      if (id > 0) bucket._conversations.add(id);
    }

    const gaps = Array.isArray(parsed.gaps_operacionais) ? parsed.gaps_operacionais : [];
    bucket.gapsCount += gaps.length;
    for (const gap of gaps) {
      const gapObj = gap && typeof gap === "object" ? (gap as Record<string, unknown>) : {};
      const sev = parseSeverity(gapObj.severidade || gapObj.severity || gapObj.nivel || gapObj.prioridade);
      if (sev === "critical") bucket.criticalGapsCount += 1;
    }

    const metric = tracking?.response_metrics?.[owner];
    const samples = Number(metric?.samples || 0);
    const avg = Number(metric?.avg_response_sec || 0);
    const max = Number(metric?.max_response_sec || 0);
    if (samples > 0 && avg > 0) {
      bucket._sumResponseSec += avg * samples;
      bucket.responseSamples += samples;
    }
    if (max > 0) {
      bucket.maxResponseSec = Math.max(Number(bucket.maxResponseSec || 0), max);
    }
  }

  const entries = owners.map((owner) => {
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
      avgResponseSec: bucket.responseSamples > 0 ? Number((bucket._sumResponseSec / bucket.responseSamples).toFixed(2)) : null,
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
