import { formatDateTimeInTimezone } from "../dateUtils";
import { getContactKey } from "./contactHelpers";

const FINALIZATION_LABELS = ["lead_agendado", "pausar_ia"];
const FINALIZATION_STATUSES = ["resolved", "closed"];

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.map((label) => String(label || "").trim().toLowerCase()).filter(Boolean);
}

function severityRank(severity) {
  const normalized = String(severity || "").toLowerCase();
  if (normalized === "critical") return 5;
  if (normalized === "high") return 4;
  if (normalized === "medium") return 3;
  if (normalized === "low") return 2;
  return 1;
}

function findLastHumanMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message) continue;
    const role = String(message?.role || "").toUpperCase();
    if (role === "USER" || role === "AGENT") {
      return message;
    }
  }
  return null;
}

function extractFinalizationActor(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = String(messages[i]?.text || "").trim();
    if (!text) continue;
    const resolvedBy = text.match(/marcada como resolvida por\s+(.+?)\./i);
    if (resolvedBy?.[1]) return resolvedBy[1].trim();
    const statusBy = text.match(/status alterado para\s+\".+?\"\s+por\s+(.+?)\./i);
    if (statusBy?.[1]) return statusBy[1].trim();
  }
  return null;
}

function deriveConversationOperationalState(log, timezone, referenceNowUnix) {
  const labelsLower = normalizeLabels(log.labels);
  const finalLabel = FINALIZATION_LABELS.find((tag) => labelsLower.includes(tag)) || null;
  const finalByLabel = Boolean(finalLabel);
  const finalByStatus = FINALIZATION_STATUSES.includes(String(log.status || "").toLowerCase());
  const finalizationActor = extractFinalizationActor(log.messages);

  const lastMessageAt = log.messages.reduce((acc, message) => Math.max(acc, Number(message?.created_at || 0)), 0);
  const lastHumanMessage = findLastHumanMessage(log.messages);
  const lastHumanRole = String(lastHumanMessage?.role || "").toUpperCase();
  const waitingOnAgent = lastHumanRole === "USER";
  const waitingOnCustomer = lastHumanRole === "AGENT";
  const pendingSinceAt = waitingOnAgent ? Number(lastHumanMessage?.created_at || 0) : 0;
  const lastInteractionAtRaw = Math.max(
    lastMessageAt,
    Number(log.last_activity_at || 0),
    Number(log.updated_at || 0),
    Number(log.timestamp || 0),
    Number(log.created_at || 0),
  );
  const lastInteractionAt = lastInteractionAtRaw ? Math.floor(lastInteractionAtRaw) : 0;
  const triggerAt = pendingSinceAt ? pendingSinceAt + 3600 : 0;
  const triggerReady = waitingOnAgent && triggerAt > 0 ? referenceNowUnix >= triggerAt : false;
  const secondsToTrigger = triggerAt > 0 ? triggerAt - referenceNowUnix : 0;
  const minutesToTrigger = waitingOnAgent && !triggerReady ? Math.max(0, Math.ceil(secondsToTrigger / 60)) : 0;
  const minutesOverdue = waitingOnAgent && triggerReady ? Math.floor((referenceNowUnix - triggerAt) / 60) : 0;

  const finalizationStatus = finalByLabel || finalByStatus ? "finalizada" : "continuada";
  const baseFinalizationReason = finalByLabel
    ? `etiqueta:${finalLabel}`
    : finalByStatus
      ? `status:${String(log.status || "").toLowerCase()}`
      : "sem_finalizacao";
  const finalizationReason = finalizationActor
    ? `${baseFinalizationReason} por ${finalizationActor}`
    : baseFinalizationReason;

  return {
    labels: labelsLower,
    finalization_status: finalizationStatus,
    finalization_reason: finalizationReason,
    finalization_actor: finalizationActor,
    waiting_on_agent: waitingOnAgent,
    waiting_on_customer: waitingOnCustomer,
    last_human_role: lastHumanRole || null,
    pending_since_at: pendingSinceAt || null,
    pending_since_at_local: formatDateTimeInTimezone(pendingSinceAt, timezone),
    last_interaction_at: lastInteractionAt || null,
    last_interaction_at_local: formatDateTimeInTimezone(lastInteractionAt, timezone),
    trigger_after_1h_at: triggerAt || null,
    trigger_after_1h_at_local: formatDateTimeInTimezone(triggerAt, timezone),
    trigger_ready: triggerReady,
    minutes_to_trigger: minutesToTrigger,
    minutes_overdue: minutesOverdue,
  };
}

function buildConversationInsights(log, state) {
  const baseContactName = log.contact?.name || log.contact?.identifier || `Contato ${log.conversation_id}`;
  const contactIdentifier = String(log.contact?.identifier || "").trim();
  const contactName = contactIdentifier && !baseContactName.includes(contactIdentifier)
    ? `${baseContactName} • ${contactIdentifier}`
    : baseContactName;
  const insights = [];

  if (state.finalization_status === "finalizada") {
    const byWho = state.finalization_actor ? `**${state.finalization_actor}**` : state.finalization_reason;
    insights.push({
      type: "finalization",
      severity: "low",
      title: "Conversa finalizada",
      summary: `Conversa marcada como finalizada por ${byWho}.`,
    });
  } else if (state.waiting_on_customer) {
    insights.push({
      type: "customer_pending",
      severity: "info",
      title: "Aguardando retorno do cliente",
      summary: `Última mensagem enviada pela IA/atendente em ${state.last_interaction_at_local}.`,
    });
  } else if (state.trigger_ready) {
    let severity = "medium";
    if (state.minutes_overdue >= 120) severity = "critical";
    else if (state.minutes_overdue >= 60) severity = "high";

    insights.push({
      type: "followup_delay",
      severity,
      title: "Cliente sem resposta após gatilho de 1h",
      summary: `Cliente aguardando resposta há ${state.minutes_overdue} min após o gatilho de 1h.`,
    });
  } else {
    insights.push({
      type: "followup_window",
      severity: "info",
      title: "Cliente aguardando resposta",
      summary: `Ainda faltam ${state.minutes_to_trigger} min para acionar o gatilho de 1h sem resposta.`,
    });
  }

  return insights.map((insight, idx) => ({
    ...insight,
    id: `${log.conversation_id}-${idx + 1}`,
    severity_rank: severityRank(insight.severity),
    conversation_id: log.conversation_id,
    contact_key: getContactKey(log),
    contact_name: contactName,
    contact: log.contact,
    labels: state.labels,
    finalization_status: state.finalization_status,
    finalization_reason: state.finalization_reason,
    finalization_actor: state.finalization_actor || null,
    status: log.status || null,
    unread_count: Number(log.unread_count || 0),
    last_interaction_at: state.last_interaction_at,
    last_interaction_at_local: state.last_interaction_at_local,
    trigger_after_1h_at: state.trigger_after_1h_at,
    trigger_after_1h_at_local: state.trigger_after_1h_at_local,
    trigger_ready: state.trigger_ready,
    minutes_to_trigger: state.minutes_to_trigger,
    minutes_overdue: state.minutes_overdue,
  }));
}


export { buildConversationInsights, deriveConversationOperationalState };

