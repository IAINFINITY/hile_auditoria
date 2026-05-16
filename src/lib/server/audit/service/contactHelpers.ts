import { createHash } from "node:crypto";
import { unique } from "../dateUtils";

function extractEnteredToday(conversations, date, toYmd) {
  return conversations.filter((item) => {
    const createdAt = Number(item?.created_at || 0);

    const toUnixSecondsSafe = (value) => {
      const n = Number(value || 0);
      if (!n || !Number.isFinite(n)) return 0;
      // Chatwoot normalmente retorna epoch em segundos, mas alguns payloads podem vir em ms.
      return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
    };

    const createdYmd = toUnixSecondsSafe(createdAt) ? toYmd(toUnixSecondsSafe(createdAt)) : null;
    return createdYmd === date;
  });
}

function compactAnalysis(raw) {
  const workflowOutputs = raw?.data?.outputs || null;
  const outputText =
    raw?.answer ||
    workflowOutputs?.text ||
    workflowOutputs?.output ||
    workflowOutputs?.analysis_output ||
    workflowOutputs?.response ||
    null;

  return {
    answer: outputText || null,
    event: raw?.event || null,
    mode: raw?.mode || null,
    workflow_status: raw?.data?.status || null,
    workflow_outputs: workflowOutputs,
    tokens: raw?.metadata?.usage?.total_tokens || raw?.data?.total_tokens || null,
    elapsed_time: raw?.metadata?.usage?.latency || raw?.data?.elapsed_time || null,
    raw,
  };
}

function buildSourceFingerprint(input) {
  return createHash("sha256").update(String(input || "")).digest("hex");
}

function getContactKey(log) {
  return String(log.contact?.id || log.contact?.identifier || `conversation-${log.conversation_id}`);
}

function normalizeIdentifierKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  return digits || raw.toLowerCase();
}

function cleanNameCandidate(value) {
  const base = String(value || "")
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/[|,;]+$/g, "")
    .trim();
  if (!base) return "";
  if (base.toLowerCase() === "null" || base.toLowerCase() === "undefined") return "";
  return base;
}

function extractNameFromFormMessages(messages) {
  if (!Array.isArray(messages)) return "";

  const patterns = [
    /"nome"\s*:\s*"([^"\n\r]+)"/i,
    /"nome"\s*:\s*([^\n\r,}]+)/i,
    /\bnome\s*:\s*"([^"\n\r]+)"/i,
    /\bnome\s*:\s*([^\n\r,}]+)/i,
  ];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (String(message?.role || "").toUpperCase() !== "USER") continue;
    const text = String(message?.text || "");
    if (!text) continue;

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const candidate = cleanNameCandidate(match?.[1] || "");
      if (!candidate) continue;
      if (candidate.length < 3) continue;
      return candidate;
    }
  }

  return "";
}

function mergeContactDisplayName(baseName, formName) {
  const original = cleanNameCandidate(baseName);
  const extracted = cleanNameCandidate(formName);
  if (!extracted) return original || "";
  if (!original) return extracted;

  const originalLower = original.toLowerCase();
  const extractedLower = extracted.toLowerCase();
  if (originalLower === extractedLower) return original;
  if (originalLower.includes(extractedLower)) return original;
  if (extractedLower.includes(originalLower)) return extracted;

  return `${extracted} (${original})`;
}

function buildContactLogs(conversationLogs) {
  const map = new Map();

  for (const log of conversationLogs) {
    const baseContactKey = getContactKey(log);
    const key = `${baseContactKey}::conversation-${log.conversation_id}`;

    if (!map.has(key)) {
      map.set(key, {
        analysis_key: key,
        contact_key: baseContactKey,
        contact: log.contact,
        conversation_ids: [],
        messages: [],
      });
    }

    const entry = map.get(key);
    entry.conversation_ids.push(log.conversation_id);

    for (const message of log.messages) {
      entry.messages.push({
        ...message,
        conversation_id: log.conversation_id,
      });
    }
  }

  return [...map.values()].map((item) => ({
    ...item,
    conversation_ids: unique(item.conversation_ids),
    messages: item.messages.sort((a, b) => a.created_at - b.created_at),
    message_count_day: item.messages.length,
  }));
}

export {
  buildContactLogs,
  buildSourceFingerprint,
  cleanNameCandidate,
  compactAnalysis,
  extractEnteredToday,
  extractNameFromFormMessages,
  getContactKey,
  mergeContactDisplayName,
  normalizeIdentifierKey,
};
