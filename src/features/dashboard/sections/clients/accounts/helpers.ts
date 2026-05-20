import type { ClientPhase, ClientRecordItem, Severity } from "../../../../../types";
import type { AccountStatus } from "./types";

export function normalizeFilterText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function toDateTimeBr(isoText: string | null): string {
  if (!isoText) return "-";
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
}

export function normalizeNarrativeDateTokens(text: string): string {
  if (!text) return text;
  return text.replace(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\]/g, (_, isoText: string) => {
    const date = new Date(isoText);
    if (Number.isNaN(date.getTime())) return `[${isoText}]`;
    return `[${date.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}]`;
  });
}

export function statusLabel(status: AccountStatus): string {
  if (status === "resolvido") return "Fora da IA";
  if (status === "remarketing") return "Remarketing";
  if (status === "atencao") return "Atenção";
  return "Entrada";
}

export function normalizeClientPhase(value: unknown): ClientPhase {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "avancado") return "avancado";
  if (normalized === "intermediario") return "intermediario";
  return "inicial";
}

export function clientPhaseLabel(value: unknown): string {
  const phase = normalizeClientPhase(value);
  if (phase === "avancado") return "Avançado";
  if (phase === "intermediario") return "Intermediário";
  return "Inicial";
}

export function clientPhaseClass(value: unknown): string {
  const phase = normalizeClientPhase(value);
  if (phase === "avancado") return "phase-avancado";
  if (phase === "intermediario") return "phase-intermediario";
  return "phase-inicial";
}

export function timelineEventLabel(eventType: string): string {
  if (eventType === "issue_opened") return "Problema aberto";
  if (eventType === "issue_updated") return "Problema atualizado";
  if (eventType === "issue_resolved") return "Problema resolvido";
  if (eventType === "moved_out_of_ai") return "Saiu do fluxo da IA";
  return eventType || "Evento operacional";
}

export function severityLabel(severity: Severity): string {
  if (severity === "critical") return "Crítico";
  if (severity === "high") return "Alto";
  if (severity === "medium") return "Médio";
  if (severity === "low") return "Baixo";
  return "Informativo";
}

export function severityClass(severity: Severity): string {
  if (severity === "critical") return "sev-critical";
  if (severity === "high") return "sev-high";
  if (severity === "medium") return "sev-medium";
  if (severity === "low") return "sev-low";
  return "sev-info";
}

export function normalizeLabelKey(label: string): string {
  return String(label || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function formatProductDisplayName(value: string): string {
  const clean = String(value || "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

export function hasExitFromAiLabel(labels: string[]): boolean {
  const normalized = (labels || []).map(normalizeLabelKey);
  return normalized.includes("lead_agendado") || normalized.includes("pausar_ia");
}

export function normalizeResponsibleBucket(value: unknown): "ia" | "suellen" | "samuel" {
  const normalized = normalizeLabelKey(String(value || ""));
  if (normalized === "samuel") return "samuel";
  if (normalized === "suellen" || normalized === "suelen") return "suellen";
  return "ia";
}

export function responsibleLabel(value: unknown): string {
  const bucket = normalizeResponsibleBucket(value);
  if (bucket === "samuel") return "Comercial Samuel";
  if (bucket === "suellen") return "Comercial Suellen";
  return "IA";
}

export function mapStatus(record: ClientRecordItem): AccountStatus {
  const pipelineBlock = normalizeLabelKey(record.pipelineBlock || "");
  if (pipelineBlock === "resolvido") return "resolvido";
  if (pipelineBlock === "atencao") return "atencao";
  if (pipelineBlock === "remarketing") return "remarketing";
  if (pipelineBlock === "entrada") return "entrada";

  if (hasExitFromAiLabel(record.labels || [])) return "resolvido";
  if (record.status === "resolvido") return "resolvido";
  if (record.severity === "critical" || record.severity === "high") return "atencao";
  return "entrada";
}

export function dateKeyNowFortaleza(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" }).format(new Date());
}


