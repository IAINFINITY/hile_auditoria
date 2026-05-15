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
