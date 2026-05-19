import type { AnalysisItem, FailureItem, InsightItem, OverviewPayload, ReportPayload } from "../../../../types";
import type { DashboardRunSnapshot } from "./runSnapshotMapper";

export interface AggregatedData {
  overview: OverviewPayload;
  insights: InsightItem[];
  report: ReportPayload;
  rawOutput: string;
}

function sumFields(snapshots: DashboardRunSnapshot[], extract: (s: DashboardRunSnapshot) => number): number {
  return snapshots.reduce((acc, s) => acc + Math.max(0, extract(s)), 0);
}

function mergeInsights(snapshots: DashboardRunSnapshot[]): InsightItem[] {
  const byContact = new Map<string, InsightItem>();
  for (const snapshot of snapshots) {
    for (const insight of snapshot.insights) {
      const key = insight.contact_key;
      const existing = byContact.get(key);
      if (!existing) {
        byContact.set(key, insight);
      } else {
        const existingTime = existing.last_interaction_at_local || "";
        const incomingTime = insight.last_interaction_at_local || "";
        if (incomingTime >= existingTime) {
          byContact.set(key, insight);
        }
      }
    }
  }
  return Array.from(byContact.values());
}

function mergeOperational(snapshots: DashboardRunSnapshot[]): OverviewPayload["conversation_operational"] {
  const byConvId = new Map<number, OverviewPayload["conversation_operational"][number]>();
  for (const snapshot of snapshots) {
    for (const op of snapshot.overview.conversation_operational) {
      byConvId.set(op.conversation_id, op);
    }
  }
  return Array.from(byConvId.values());
}

function mergeAnalyses(snapshots: DashboardRunSnapshot[]): AnalysisItem[] {
  const byContactKey = new Map<string, AnalysisItem>();
  for (const snapshot of snapshots) {
    const analyses = snapshot.report?.raw_analysis?.analyses || [];
    for (const analysis of analyses) {
      byContactKey.set(analysis.contact_key, analysis);
    }
  }
  return Array.from(byContactKey.values());
}

function mergeFailures(snapshots: DashboardRunSnapshot[]): FailureItem[] {
  const seen = new Map<string, FailureItem>();
  for (const snapshot of snapshots) {
    const failures = snapshot.report?.raw_analysis?.failures || [];
    for (const f of failures) {
      const key = `${f.contact_key}|${f.error_message}`;
      seen.set(key, f);
    }
  }
  return Array.from(seen.values());
}

function mergeResponsiblePerformance(snapshots: DashboardRunSnapshot[]) {
  const owners: Array<"ia" | "suellen" | "samuel"> = ["ia", "suellen", "samuel"];
  const base = {
    owner_label: "",
    analyses_count: 0,
    contacts_count: 0,
    conversations_count: 0,
    message_count_agent: 0,
    gaps_count: 0,
    critical_gaps_count: 0,
    improvements_count: 0,
    avg_response_sec: null as number | null,
    max_response_sec: null as number | null,
    response_samples: 0,
    _sum_response: 0,
  };

  const merged = {
    ia: { ...base, owner_label: "IA" },
    suellen: { ...base, owner_label: "Comercial Suellen" },
    samuel: { ...base, owner_label: "Comercial Samuel" },
  };

  for (const snapshot of snapshots) {
    const perf = snapshot.report?.summary?.responsible_performance;
    if (!perf) continue;
    for (const owner of owners) {
      const row = perf[owner];
      const target = merged[owner];
      target.owner_label = row.owner_label || target.owner_label;
      target.analyses_count += Number(row.analyses_count || 0);
      target.contacts_count += Number(row.contacts_count || 0);
      target.conversations_count += Number(row.conversations_count || 0);
      target.message_count_agent += Number(row.message_count_agent || 0);
      target.gaps_count += Number(row.gaps_count || 0);
      target.critical_gaps_count += Number(row.critical_gaps_count || 0);
      target.improvements_count += Number(row.improvements_count || 0);
      target.response_samples += Number(row.response_samples || 0);
      if (row.avg_response_sec !== null && row.avg_response_sec !== undefined) {
        target._sum_response += Number(row.avg_response_sec || 0) * Math.max(1, Number(row.response_samples || 1));
      }
      if (row.max_response_sec !== null && row.max_response_sec !== undefined) {
        target.max_response_sec = Math.max(Number(target.max_response_sec || 0), Number(row.max_response_sec || 0));
      }
    }
  }

  for (const owner of owners) {
    const target = merged[owner];
    target.avg_response_sec =
      target.response_samples > 0 ? Number((target._sum_response / target.response_samples).toFixed(2)) : null;
    if (!target.max_response_sec || target.max_response_sec <= 0) target.max_response_sec = null;
  }

  return {
    ia: {
      owner_label: merged.ia.owner_label,
      analyses_count: merged.ia.analyses_count,
      contacts_count: merged.ia.contacts_count,
      conversations_count: merged.ia.conversations_count,
      message_count_agent: merged.ia.message_count_agent,
      gaps_count: merged.ia.gaps_count,
      critical_gaps_count: merged.ia.critical_gaps_count,
      improvements_count: merged.ia.improvements_count,
      avg_response_sec: merged.ia.avg_response_sec,
      max_response_sec: merged.ia.max_response_sec,
      response_samples: merged.ia.response_samples,
    },
    suellen: {
      owner_label: merged.suellen.owner_label,
      analyses_count: merged.suellen.analyses_count,
      contacts_count: merged.suellen.contacts_count,
      conversations_count: merged.suellen.conversations_count,
      message_count_agent: merged.suellen.message_count_agent,
      gaps_count: merged.suellen.gaps_count,
      critical_gaps_count: merged.suellen.critical_gaps_count,
      improvements_count: merged.suellen.improvements_count,
      avg_response_sec: merged.suellen.avg_response_sec,
      max_response_sec: merged.suellen.max_response_sec,
      response_samples: merged.suellen.response_samples,
    },
    samuel: {
      owner_label: merged.samuel.owner_label,
      analyses_count: merged.samuel.analyses_count,
      contacts_count: merged.samuel.contacts_count,
      conversations_count: merged.samuel.conversations_count,
      message_count_agent: merged.samuel.message_count_agent,
      gaps_count: merged.samuel.gaps_count,
      critical_gaps_count: merged.samuel.critical_gaps_count,
      improvements_count: merged.samuel.improvements_count,
      avg_response_sec: merged.samuel.avg_response_sec,
      max_response_sec: merged.samuel.max_response_sec,
      response_samples: merged.samuel.response_samples,
    },
  };
}

export function aggregateSnapshots(snapshots: DashboardRunSnapshot[], dateLabel: string): AggregatedData {
  if (snapshots.length === 0) {
    throw new Error("Nenhum snapshot para agregar");
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const mergedInsights = mergeInsights(snapshots);
  const mergedOperational = mergeOperational(snapshots);
  const mergedAnalyses = mergeAnalyses(snapshots);
  const mergedFailuresList = mergeFailures(snapshots);

  const criticalCount = mergedInsights.filter((i) => i.severity === "critical").length;
  const nonCriticalCount = mergedInsights.filter((i) => i.severity !== "critical").length;
  const finalizedCount = sumFields(snapshots, (s) => s.overview.overview.finalized_count);
  const continuedCount = sumFields(snapshots, (s) => s.overview.overview.continued_count);
  const totalScanned = sumFields(snapshots, (s) => s.overview.overview.conversations_scanned);
  const totalEntered = sumFields(snapshots, (s) => s.overview.overview.conversations_entered_today);
  const totalProcessed = sumFields(snapshots, (s) => s.overview.overview.conversations_total_analyzed_day);
  const totalAnalysisCount = sumFields(snapshots, (s) => s.overview.overview.total_analysis_count);
  const totalMessagesDay = sumFields(snapshots, (s) => s.overview.overview.total_messages_day);
  const totalRepeated = sumFields(snapshots, (s) => s.overview.overview.repeated_identifier_count ?? 0);
  const totalTriggerReady = sumFields(snapshots, (s) => s.overview.overview.trigger_ready_count);

  const overview: OverviewPayload = {
    date: dateLabel,
    timezone: first.overview.timezone,
    generated_at: new Date().toISOString(),
    account: first.overview.account,
    inbox: first.overview.inbox,
    overview: {
      conversations_scanned: totalScanned,
      conversations_entered_today: totalEntered,
      unique_contacts_today: mergedInsights.length,
      conversations_total_analyzed_day: totalProcessed,
      total_analysis_count: totalAnalysisCount,
      total_messages_day: totalMessagesDay,
      repeated_identifier_count: totalRepeated,
      finalized_count: finalizedCount,
      continued_count: continuedCount,
      trigger_ready_count: totalTriggerReady,
      critical_insights_count: criticalCount,
      non_critical_insights_count: nonCriticalCount,
      insights_total: mergedInsights.length,
    },
    insights: mergedInsights,
    conversation_operational: mergedOperational,
  };

  const totalFailures = mergedFailuresList.length;
  const periodReportMarkdown = `## Período: ${dateLabel}\n\n**${snapshots.length} dia(s) agregados**  \n**${mergedInsights.length} contatos únicos**  \n\n---\n\n${last.report?.report_markdown || ""}`;

  const report: ReportPayload = {
    date: dateLabel,
    account: first.report?.account || { id: 0, name: null, role: null },
    inbox: first.report?.inbox || { id: 0, name: null, provider: null, channel_type: null, phone_number: null },
    report_markdown: periodReportMarkdown,
    summary: {
      conversations_entered_today: totalEntered,
      unique_contacts_today: mergedInsights.length,
      total_to_process: totalScanned,
      processed: totalProcessed,
      analyses_count: mergedAnalyses.length,
      failures_count: totalFailures,
      critical_count: criticalCount,
      improvements_count: nonCriticalCount,
      gaps_count: criticalCount,
      responsible_performance: mergeResponsiblePerformance(snapshots),
    },
    execution_order: snapshots.flatMap((s) => s.report?.execution_order || []),
    raw_analysis: {
      account: first.report?.account,
      inbox: first.report?.inbox,
      analyses: mergedAnalyses,
      failures: mergedFailuresList,
      run_stats: {
        total_to_process: totalScanned,
        processed: totalProcessed,
        success_count: totalProcessed,
        failure_count: totalFailures,
        success_rate: totalScanned > 0 ? Number(((totalProcessed / totalScanned) * 100).toFixed(2)) : 0,
      },
    },
  };

  return {
    overview,
    insights: mergedInsights,
    report,
    rawOutput: periodReportMarkdown,
  };
}
