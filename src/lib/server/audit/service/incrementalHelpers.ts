import { createHash } from "node:crypto";
import type { NormalizedMessage } from "../types";

interface DeltaStateLike {
  lastAnalyzedMessageId: number | null;
  lastStatus: string | null;
  lastLabels: string[];
  lastMessageRole: string | null;
}

interface RelevanceInput {
  newMessages: NormalizedMessage[];
  previous: DeltaStateLike | null;
  currentLabels: string[];
  currentStatus: string | null;
  unansweredMinutes: number;
  unansweredThresholdMinutes: number;
}

function norm(text: string): string {
  return String(text || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function hasUserQuestion(messages: NormalizedMessage[]): boolean {
  return messages.some((message) => {
    const role = String(message.role || "").toUpperCase();
    if (role !== "USER") return false;
    const text = String(message.text || "").trim();
    if (!text) return false;
    if (text.startsWith("[")) return false;
    return /\?|como|quando|quanto|qual|quero|preciso|ajuda/i.test(text);
  });
}

function hasRoleExchange(messages: NormalizedMessage[], previousRole: string | null): boolean {
  const roles = messages
    .map((message) => String(message.role || "").toUpperCase())
    .filter((role) => role === "USER" || role === "AGENT");

  if (roles.length === 0) return false;
  if (new Set(roles).size > 1) return true;
  if (!previousRole) return false;
  return roles[0] !== String(previousRole || "").toUpperCase();
}

function hasRelevantLabelChange(previousLabels: string[], currentLabels: string[]): boolean {
  const prev = new Set((previousLabels || []).map(norm));
  const curr = new Set((currentLabels || []).map(norm));
  if (prev.size !== curr.size) return true;
  for (const label of curr) {
    if (!prev.has(label)) return true;
  }
  return false;
}

function hasCriticalLabel(labels: string[]): boolean {
  const normalized = (labels || []).map(norm);
  return normalized.includes("lead_agendado") || normalized.includes("pausar_ia");
}

export function getLastMessageId(messages: NormalizedMessage[]): number | null {
  let best = 0;
  for (const message of messages || []) {
    const id = Number(message?.id || 0);
    if (id > best) best = id;
  }
  return best > 0 ? best : null;
}

export function filterNewMessages(messages: NormalizedMessage[], lastAnalyzedMessageId: number | null): NormalizedMessage[] {
  const threshold = Number(lastAnalyzedMessageId || 0);
  if (!threshold) return [...(messages || [])];
  return (messages || []).filter((message) => Number(message?.id || 0) > threshold);
}

export function buildDeltaHash(params: {
  conversationId: number;
  status: string | null;
  labels: string[];
  messages: NormalizedMessage[];
}): string {
  const payload = {
    conversation_id: params.conversationId,
    status: String(params.status || "").trim().toLowerCase(),
    labels: [...(params.labels || [])].map(norm).sort(),
    messages: (params.messages || []).map((message) => ({
      id: Number(message.id || 0),
      created_at: Number(message.created_at || 0),
      role: String(message.role || "").toUpperCase(),
      text: String(message.text || "").trim(),
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function evaluateDeltaRelevance(input: RelevanceInput): {
  relevant: boolean;
  score: number;
  reasons: string[];
  hasCriticalRule: boolean;
} {
  const reasons: string[] = [];
  let score = 0;

  const prev = input.previous;
  const newMessages = input.newMessages || [];

  const roleExchange = hasRoleExchange(newMessages, prev?.lastMessageRole || null);
  if (roleExchange) {
    score += 2;
    reasons.push("troca USER↔AGENT");
  }

  const userQuestion = hasUserQuestion(newMessages);
  if (userQuestion) {
    score += 2;
    reasons.push("nova mensagem do usuário com possível demanda");
  }

  const criticalLabel = hasCriticalLabel(input.currentLabels);
  if (criticalLabel) {
    score += 2;
    reasons.push("etiqueta crítica detectada");
  }

  const labelChanged = hasRelevantLabelChange(prev?.lastLabels || [], input.currentLabels || []);
  if (labelChanged) {
    score += 1;
    reasons.push("mudança de etiquetas");
  }

  const statusChanged = String(prev?.lastStatus || "") !== String(input.currentStatus || "");
  if (statusChanged) {
    score += 1;
    reasons.push("mudança de status da conversa");
  }

  if (newMessages.length >= 3) {
    score += 1;
    reasons.push("volume de mensagens novas >= 3");
  }

  const unansweredExceeded = input.unansweredMinutes >= input.unansweredThresholdMinutes;
  if (unansweredExceeded) {
    score += 2;
    reasons.push(`sem resposta acima de ${input.unansweredThresholdMinutes} min`);
  }

  const hasCriticalRule = criticalLabel || unansweredExceeded;
  const relevant = hasCriticalRule || score >= 2;

  return {
    relevant,
    score,
    reasons,
    hasCriticalRule,
  };
}
