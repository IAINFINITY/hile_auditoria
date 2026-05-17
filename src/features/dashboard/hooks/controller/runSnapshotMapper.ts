import type { AnalysisItem, InsightItem, OverviewPayload, ReportByDateResponse, ReportPayload, Severity } from "../../../../types";
import {
  asBoolean,
  asNumber,
  asRecord,
  asString,
  inferSeverityFromValue,
  normalizeTextForMatch,
  parseJsonObject,
  toTitleCaseName,
} from "./common";

export type DashboardRunSnapshot = {
  overview: OverviewPayload;
  insights: InsightItem[];
  report: ReportPayload;
  rawOutput: string;
};

function extractMaxSeverityFromAnswer(answer: Record<string, unknown>): string {
  const topLevel = asString(answer.severidade || answer.severity || answer.nivel_risco || answer.risco || "");
  if (topLevel && /crit|alt|med|baix|info/.test(normalizeTextForMatch(topLevel))) return topLevel;

  const gaps = Array.isArray(answer.gaps_operacionais) ? answer.gaps_operacionais.map(asRecord) : [];
  let highest = "info";
  const order = (s: string) => {
    const n = normalizeTextForMatch(s);
    if (n.includes("crit")) return 1;
    if (n.includes("alt")) return 2;
    if (n.includes("med")) return 3;
    if (n.includes("baix")) return 4;
    if (n.includes("info")) return 5;
    return 99;
  };

  for (const gap of gaps) {
    const sev = asString(gap.severidade || gap.severity || gap.nivel || gap.prioridade || "");
    if (!sev) continue;
    if (order(sev) < order(highest)) highest = sev;
  }

  if (order(highest) < 5) return highest;
  // fallback final: only when analysis did not return usable severity labels
  if (asBoolean(answer.risco_critico)) return "critical";
  return "info";
}

export function mapRunToDashboardSnapshot(run: ReportByDateResponse["run"]): DashboardRunSnapshot {
  const reportJson = asRecord(run.report_json);
  const summary = asRecord(reportJson.summary);
  const account = asRecord(reportJson.account);
  const inbox = asRecord(reportJson.inbox);
  const rawAnalysis = asRecord(reportJson.raw_analysis);
  const rawAnalyses = Array.isArray(rawAnalysis.analyses) ? rawAnalysis.analyses.map(asRecord) : [];

  const operationalByConversation = new Map<number, Record<string, unknown>>();
  const operationalRows: OverviewPayload["conversation_operational"] = [];

  for (const item of rawAnalyses) {
    const contact = asRecord(item.contact);
    const contactName = toTitleCaseName(asString(contact.name || contact.identifier || item.contact_key));
    const contactIdentifier = asString(contact.identifier || "");
    const contactKey = asString(item.contact_key || contactIdentifier || contactName || "contato");
    const messageCountDay = asNumber(item.message_count_day, 0);
    const ops = Array.isArray(item.conversation_operational) ? item.conversation_operational.map(asRecord) : [];
    for (const op of ops) {
      const state = asRecord(op.state);
      const conversationId = asNumber(op.conversation_id, 0);
      if (!conversationId) continue;

      operationalByConversation.set(conversationId, state);
      operationalRows.push({
        conversation_id: conversationId,
        contact_key: contactKey,
        finalization_status: asString(state.finalization_status, "continuada") === "finalizada" ? "finalizada" : "continuada",
        finalization_reason: asString(state.finalization_reason, "sem_finalizacao"),
        finalization_actor: asString(state.finalization_actor || "") || null,
        waiting_on_agent: asBoolean(state.waiting_on_agent),
        waiting_on_customer: asBoolean(state.waiting_on_customer),
        pending_since_at: state.pending_since_at === null || state.pending_since_at === undefined ? null : asNumber(state.pending_since_at, 0),
        pending_since_at_local: asString(state.pending_since_at_local || "") || null,
        last_interaction_at_local: asString(state.last_interaction_at_local || "") || null,
        trigger_after_1h_at_local: asString(state.trigger_after_1h_at_local || "") || null,
        trigger_ready: asBoolean(state.trigger_ready),
        minutes_overdue: asNumber(state.minutes_overdue, 0),
        message_count_day: messageCountDay,
        unread_count: asNumber(state.unread_count, 0),
        status: asString(state.status || "") || null,
        labels: Array.isArray(state.labels) ? state.labels.map((v) => String(v)) : [],
        contact: { name: contactName || null, identifier: contactIdentifier || null },
      });
    }
  }

  const compactLogs = Array.isArray(reportJson.logs) ? reportJson.logs.map(asRecord) : [];
  const logs: Array<Record<string, unknown>> = compactLogs.length > 0
    ? compactLogs
    : rawAnalyses.map((item, index) => {
        const contact = asRecord(item.contact);
        const ops = Array.isArray(item.conversation_operational) ? item.conversation_operational.map(asRecord) : [];
        const firstOpState = asRecord(asRecord(ops[0]).state);
        const parsedAnswer = parseJsonObject(asRecord(item.analysis).answer);
        return {
          contact_key: String(item.contact_key || `contact-${index + 1}`),
          contact_name: toTitleCaseName(String(contact.name || contact.identifier || item.contact_key || `Contato ${index + 1}`)),
          conversation_ids: Array.isArray(item.conversation_ids) ? item.conversation_ids : [],
          risk_level: extractMaxSeverityFromAnswer(parsedAnswer),
          summary: String(parsedAnswer.resumo || ""),
          improvements: Array.isArray(parsedAnswer.pontos_melhoria) ? parsedAnswer.pontos_melhoria : [],
          next_steps: Array.isArray(parsedAnswer.proximos_passos) ? parsedAnswer.proximos_passos : [],
          finalization_status: firstOpState.finalization_status || "continuada",
          finalization_actor: firstOpState.finalization_actor || null,
          labels: Array.isArray(firstOpState.labels) ? firstOpState.labels : [],
        };
      });

  if (compactLogs.length > 0 && rawAnalyses.length > 0) {
    for (const log of logs) {
      const logContactKey = asString(log.contact_key || "");
      if (!logContactKey) continue;
      const raw = rawAnalyses.find((r) => asString(r.contact_key || "") === logContactKey);
      if (!raw) continue;
      const parsed = parseJsonObject(asRecord(raw.analysis).answer);
      if (Object.keys(parsed).length > 0) {
        log.risk_level = extractMaxSeverityFromAnswer(parsed);
      }
    }
  }

  if (operationalRows.length === 0 && compactLogs.length > 0) {
    for (const log of compactLogs) {
      const conversationIds = Array.isArray(log.conversation_ids)
        ? log.conversation_ids.map((id) => asNumber(id, 0)).filter((id) => id > 0)
        : [];
      for (const conversationId of conversationIds) {
        const fallbackState = {
          finalization_status: log.finalization_status,
          finalization_reason: log.finalization_reason || log.finalization_status || "continuada",
          finalization_actor: log.finalization_actor,
          waiting_on_agent: log.waiting_on_agent,
          waiting_on_customer: log.waiting_on_customer,
          pending_since_at: log.pending_since_at,
          pending_since_at_local: log.pending_since_at_local,
          last_interaction_at_local: log.last_interaction_at_local,
          trigger_after_1h_at_local: log.trigger_after_1h_at_local,
          trigger_ready: log.trigger_ready,
          minutes_overdue: log.minutes_overdue,
          labels: log.labels,
        };
        operationalByConversation.set(conversationId, fallbackState);
        operationalRows.push({
          conversation_id: conversationId,
          contact_key: asString(log.contact_key || "contato"),
          finalization_status: asString(log.finalization_status, "continuada") === "finalizada" ? "finalizada" : "continuada",
          finalization_reason: asString(log.finalization_reason || log.finalization_status, "continuada"),
          finalization_actor: asString(log.finalization_actor || "") || null,
          waiting_on_agent: asBoolean(log.waiting_on_agent),
          waiting_on_customer: asBoolean(log.waiting_on_customer),
          pending_since_at: log.pending_since_at === null || log.pending_since_at === undefined ? null : asNumber(log.pending_since_at, 0),
          pending_since_at_local: asString(log.pending_since_at_local || "") || null,
          last_interaction_at_local: asString(log.last_interaction_at_local || "") || null,
          trigger_after_1h_at_local: asString(log.trigger_after_1h_at_local || "") || null,
          trigger_ready: asBoolean(log.trigger_ready),
          minutes_overdue: asNumber(log.minutes_overdue, 0),
          message_count_day: asNumber(log.message_count_day, 0),
          unread_count: 0,
          status: null,
          labels: Array.isArray(log.labels) ? log.labels.map((v) => String(v)) : [],
          contact: {
            name: toTitleCaseName(asString(log.contact_name || log.contact_key || "")) || null,
            identifier: null,
          },
        });
      }
    }
  }

  const uniqueContacts = new Set(logs.map((log) => String(log.contact_key || "")).filter(Boolean));
  const finalizedCount = logs.filter((log) => String(log.finalization_status || "").toLowerCase() === "finalizada").length;
  const criticalCount = logs.filter((log) => String(log.risk_level || "").toLowerCase() === "critical").length;
  const messageCountFromRaw = rawAnalyses.reduce((acc, item) => acc + asNumber(item.message_count_day, 0), 0);
  const messageCountFromLogs = logs.reduce((acc, item) => acc + asNumber(item.message_count_day, 0), 0);
  const messageCountFromOperations = operationalRows.reduce((acc, item) => acc + asNumber(item.message_count_day, 0), 0);
  const totalMessagesDay =
    messageCountFromOperations > 0
      ? messageCountFromOperations
      : messageCountFromRaw > 0
        ? messageCountFromRaw
        : messageCountFromLogs > 0
          ? messageCountFromLogs
          : Math.max(0, asNumber(summary.total_messages_day, 0), run.processed);
  let improvementFallbackCount = 0;
  for (const item of logs) {
    const list = Array.isArray(item.improvements) ? item.improvements : [];
    improvementFallbackCount += list.length;
  }

  const insights: InsightItem[] = logs.flatMap((log, index) => {
    const conversationIds = Array.isArray(log.conversation_ids)
      ? log.conversation_ids.map((id) => asNumber(id, 0)).filter((id) => id > 0)
      : [];

    const riskLevelRaw = String(log.risk_level || "").toLowerCase();
    const severity: Severity = riskLevelRaw === "non_critical" ? "info" : inferSeverityFromValue(riskLevelRaw);
    return (conversationIds.length ? conversationIds : [index + 1]).map((conversationId, subIndex) => ({
      ...(operationalByConversation.get(conversationId) || {}),
      id: `${run.id}-${index + 1}-${subIndex + 1}`,
      severity,
      title: severity === "critical" ? "Gap crítico registrado" : "Registro operacional",
      summary: String(log.summary || "Sem resumo disponível."),
      conversation_id: conversationId,
      contact_key: String(log.contact_key || `contact-${index + 1}`),
      contact_name: toTitleCaseName(String(log.contact_name || log.contact_key || "Contato")),
      finalization_status:
        asString(
          (operationalByConversation.get(conversationId) || {}).finalization_status || log.finalization_status,
          "continuada",
        ).toLowerCase() === "finalizada"
          ? "finalizada"
          : "continuada",
      finalization_reason: log.finalization_actor
        ? `finalizada por ${String(log.finalization_actor)}`
        : asString((operationalByConversation.get(conversationId) || {}).finalization_reason || log.finalization_status, "continuada"),
      finalization_actor: asString((operationalByConversation.get(conversationId) || {}).finalization_actor || log.finalization_actor) || null,
      labels: Array.isArray((operationalByConversation.get(conversationId) || {}).labels)
        ? ((operationalByConversation.get(conversationId) || {}).labels as unknown[]).map((v) => String(v))
        : Array.isArray(log.labels)
          ? log.labels.map((v) => String(v))
          : [],
      status: null,
      unread_count: 0,
      last_interaction_at_local: asString((operationalByConversation.get(conversationId) || {}).last_interaction_at_local) || null,
      trigger_after_1h_at_local: asString((operationalByConversation.get(conversationId) || {}).trigger_after_1h_at_local) || null,
    }));
  });

  const conversationOperational = operationalRows.length > 0
    ? operationalRows
    : insights.map((insight) => ({
        conversation_id: insight.conversation_id,
        contact_key: insight.contact_key,
        finalization_status: insight.finalization_status,
        finalization_reason: insight.finalization_reason,
        finalization_actor: insight.finalization_actor,
        waiting_on_agent: insight.finalization_status !== "finalizada",
        waiting_on_customer: insight.finalization_status === "finalizada",
        pending_since_at: null,
        pending_since_at_local: null,
        last_interaction_at_local: insight.last_interaction_at_local || null,
        trigger_after_1h_at_local: insight.trigger_after_1h_at_local || null,
        trigger_ready: false,
        minutes_overdue: 0,
        message_count_day: 0,
        unread_count: 0,
        status: null,
        labels: [],
        contact: { name: insight.contact_name, identifier: null },
      }));

  const findMatchingLog = (rawItem: Record<string, unknown>, fallbackIndex: number): Record<string, unknown> | null => {
    const rawContactKey = asString(rawItem.contact_key || "");
    const rawConversationIds = Array.isArray(rawItem.conversation_ids)
      ? rawItem.conversation_ids.map((v) => asNumber(v, 0)).filter((id) => id > 0)
      : [];

    const byConversation = logs.find((log) => {
      const ids = Array.isArray(log.conversation_ids) ? log.conversation_ids.map((v) => asNumber(v, 0)) : [];
      return ids.some((id) => rawConversationIds.includes(id));
    });
    if (byConversation) return byConversation;

    if (rawContactKey) {
      const byContact = logs.find((log) => asString(log.contact_key || "") === rawContactKey);
      if (byContact) return byContact;
    }

    return logs[fallbackIndex] || null;
  };

  const analysisRows: AnalysisItem[] =
    rawAnalyses.length > 0
      ? rawAnalyses.map((rawItem, index) => {
          const matchedLog = findMatchingLog(rawItem, index);
          const conversationIds = Array.isArray(rawItem.conversation_ids)
            ? rawItem.conversation_ids.map((v) => asNumber(v, 0)).filter((id) => id > 0)
            : Array.isArray(matchedLog?.conversation_ids)
              ? matchedLog.conversation_ids.map((v) => asNumber(v, 0)).filter((id) => id > 0)
              : [];

          const contactRecord = asRecord(rawItem.contact);
          const contactName = toTitleCaseName(asString(
            contactRecord.name ||
              contactRecord.identifier ||
              rawItem.contact_key ||
              matchedLog?.contact_name ||
              matchedLog?.contact_key ||
              `Contato ${index + 1}`,
          ));

          const answerRaw = asString(asRecord(rawItem.analysis).answer || "");
          const answerParsed = parseJsonObject(answerRaw);
          const answerObject =
            Object.keys(answerParsed).length > 0
              ? answerParsed
              : {
                  resumo: asString(matchedLog?.summary || "Sem resumo estruturado."),
                  pontos_melhoria: Array.isArray(matchedLog?.improvements)
                    ? matchedLog.improvements.map((v) => String(v))
                    : [],
                  proximos_passos: Array.isArray(matchedLog?.next_steps)
                    ? matchedLog.next_steps.map((v) => String(v))
                    : [],
                  risco_critico: asString(matchedLog?.risk_level || "").toLowerCase() === "critical",
                };

          const rawOperational = Array.isArray(rawItem.conversation_operational)
            ? rawItem.conversation_operational.map(asRecord)
            : [];

          const operationalItems: NonNullable<AnalysisItem["conversation_operational"]> =
            rawOperational.length > 0
              ? rawOperational.map((entry) => {
                  const stateRaw = asRecord(entry.state);
                  return {
                    conversation_id: asNumber(entry.conversation_id, 0),
                    state: {
                      finalization_status:
                        asString(stateRaw.finalization_status, "continuada") === "finalizada" ? "finalizada" : "continuada",
                      finalization_reason: asString(stateRaw.finalization_reason || ""),
                      finalization_actor: asString(stateRaw.finalization_actor || "") || null,
                      waiting_on_agent: asBoolean(stateRaw.waiting_on_agent),
                      waiting_on_customer: asBoolean(stateRaw.waiting_on_customer),
                      labels: Array.isArray(stateRaw.labels) ? stateRaw.labels.map((item) => String(item)) : [],
                    },
                  };
                })
              : conversationIds.map((conversationId) => {
                  const stateRaw = asRecord(operationalByConversation.get(conversationId));
                  return {
                    conversation_id: conversationId,
                    state: {
                      finalization_status:
                        asString(stateRaw.finalization_status, "continuada") === "finalizada" ? "finalizada" : "continuada",
                      finalization_reason: asString(stateRaw.finalization_reason || ""),
                      finalization_actor: asString(stateRaw.finalization_actor || "") || null,
                      waiting_on_agent: asBoolean(stateRaw.waiting_on_agent),
                      waiting_on_customer: asBoolean(stateRaw.waiting_on_customer),
                      labels: Array.isArray(stateRaw.labels) ? stateRaw.labels.map((item) => String(item)) : [],
                    },
                  };
                });

          return {
            analysis_index: asNumber(rawItem.analysis_index, index + 1),
            source_fingerprint: asString(rawItem.source_fingerprint || ""),
            contact_key: asString(rawItem.contact_key || `contact-${index + 1}`),
            contact: {
              name: contactName,
              identifier: asString(contactRecord.identifier || "") || null,
            },
            conversation_ids: conversationIds,
            message_count_day: asNumber(rawItem.message_count_day, asNumber(matchedLog?.message_count_day, 0)),
            log_text: asString(rawItem.log_text || ""),
            conversation_operational: operationalItems,
            analysis: {
              answer: JSON.stringify(answerObject, null, 2),
            },
          };
        })
      : logs.map((log, index) => {
          const contactName = toTitleCaseName(String(log.contact_name || log.contact_key || `Contato ${index + 1}`));
          const improvements = Array.isArray(log.improvements) ? log.improvements.map((v) => String(v)) : [];
          const nextSteps = Array.isArray(log.next_steps) ? log.next_steps.map((v) => String(v)) : [];
          const riskCritical = String(log.risk_level || "").toLowerCase() === "critical";
          const conversationIds = Array.isArray(log.conversation_ids) ? log.conversation_ids.map((v) => asNumber(v, 0)) : [];
          const operationalItems: NonNullable<AnalysisItem["conversation_operational"]> = conversationIds.map((conversationId) => {
            const stateRaw = asRecord(operationalByConversation.get(conversationId));
            return {
              conversation_id: conversationId,
              state: {
                finalization_status: asString(stateRaw.finalization_status, "continuada") === "finalizada" ? "finalizada" : "continuada",
                finalization_reason: asString(stateRaw.finalization_reason || ""),
                finalization_actor: asString(stateRaw.finalization_actor || "") || null,
                waiting_on_agent: asBoolean(stateRaw.waiting_on_agent),
                waiting_on_customer: asBoolean(stateRaw.waiting_on_customer),
                labels: Array.isArray(stateRaw.labels) ? stateRaw.labels.map((item) => String(item)) : [],
              },
            };
          });
          return {
            analysis_index: index + 1,
            contact_key: String(log.contact_key || `contact-${index + 1}`),
            contact: { name: contactName, identifier: null },
            conversation_ids: conversationIds,
            message_count_day: asNumber(log.message_count_day, 0),
            conversation_operational: operationalItems,
            analysis: {
              answer: JSON.stringify(
                {
                  resumo: String(log.summary || ""),
                  pontos_melhoria: improvements,
                  proximos_passos: nextSteps,
                  risco_critico: riskCritical,
                },
                null,
                2,
              ),
            },
          };
        });

  const report: ReportPayload = {
    date: run.date_ref,
    account: {
      id: asNumber(account.id, 0),
      name: account.name ? String(account.name) : null,
      role: null,
    },
    inbox: {
      id: asNumber(inbox.id, 0),
      name: inbox.name ? String(inbox.name) : null,
      provider: inbox.provider ? String(inbox.provider) : null,
      channel_type: null,
      phone_number: null,
    },
    report_markdown: run.report_markdown || "",
    summary: {
      conversations_entered_today: asNumber(summary.conversations_entered_today, run.total_conversations),
      unique_contacts_today: asNumber(summary.unique_contacts_today, uniqueContacts.size),
      total_to_process: asNumber(summary.total_to_process, run.total_conversations),
      processed: asNumber(summary.processed, run.processed),
      analyses_count: asNumber(summary.analyses_count, analysisRows.length),
      failures_count: asNumber(summary.failures_count, run.failure_count),
      critical_count: asNumber(summary.critical_count, criticalCount),
      improvements_count: asNumber(summary.improvements_count, improvementFallbackCount),
      gaps_count: asNumber(summary.gaps_count, criticalCount),
    },
    execution_order: [],
    raw_analysis: {
      analyses: analysisRows,
      failures: [],
      run_stats: {
        total_to_process: run.total_conversations,
        processed: run.processed,
        success_count: run.success_count,
        failure_count: run.failure_count,
        success_rate: run.total_conversations > 0 ? Number(((run.success_count / run.total_conversations) * 100).toFixed(2)) : 0,
      },
    },
  };

  return {
    overview: {
      date: run.date_ref,
      timezone: "America/Fortaleza",
      generated_at: run.finished_at || run.started_at,
      account: report.account,
      inbox: report.inbox,
      overview: {
        conversations_scanned: run.total_conversations,
        conversations_entered_today: report.summary.conversations_entered_today,
        unique_contacts_today: report.summary.unique_contacts_today,
        conversations_total_analyzed_day: Math.max(
          0,
          run.processed,
          report.summary.processed,
          report.summary.analyses_count,
        ),
        total_analysis_count: report.summary.analyses_count,
        total_messages_day: totalMessagesDay,
        repeated_identifier_count: 0,
        finalized_count: finalizedCount,
        continued_count: Math.max(0, run.processed - finalizedCount),
        trigger_ready_count: conversationOperational.filter((item) => item.trigger_ready).length,
        critical_insights_count: criticalCount,
        non_critical_insights_count: Math.max(0, insights.length - criticalCount),
        insights_total: insights.length,
      },
      insights,
      conversation_operational: conversationOperational,
    },
    insights,
    report,
    rawOutput: run.report_markdown || "",
  };
}



