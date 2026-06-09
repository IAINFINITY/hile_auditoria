import type { Severity } from "../../../../types";
import { normalizeSeverity, severityColors, severityLabel } from "../../shared/constants";

export type SeverityFilter = "all" | Exclude<Severity, "info">;

export interface ReportItem {
  key: string;
  title: string;
  desc: string;
  phase?: string;
  severity: Severity;
  contactName: string;
  labels: string[];
}

export interface ContactContextItem {
  key: string;
  contactName: string;
  phase: "inicial" | "intermediario" | "avancado";
  situacao: string;
  contexto: string;
  evidencia: string;
  risco: string;
  acao: string;
  labels: string[];
  severity: Severity;
}

export const REPORT_SEVERITY_OPTIONS: Array<{ value: SeverityFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "critical", label: severityLabel.critical },
  { value: "high", label: severityLabel.high },
  { value: "medium", label: severityLabel.medium },
  { value: "low", label: severityLabel.low },
];

export const KNOWN_LABELS = ["lead_agendado", "pausar_ia"];

export function toneColor(severity: Severity): string {
  return severityColors[severity];
}

export function labelClass(tag: string): string {
  const value = String(tag || "").toLowerCase();
  if (value.includes("lead_agendado")) return "tag tag-ok";
  if (value.includes("pausar_ia")) return "tag tag-pause";
  return "tag";
}

export function paginate<T>(items: T[], page: number, perPage: number): { rows: T[]; pages: number; safePage: number } {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * perPage;
  return { rows: items.slice(start, start + perPage), pages, safePage };
}

export function parsePossibleJsonObject(text: string): Record<string, unknown> {
  const raw = String(text || "").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    if (!fenced?.[1]) return {};
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return {};
    }
  }
}

export function parseLabelsFromLogText(logText: string): string[] {
  const tags = new Set<string>();
  for (const line of String(logText || "").split("\n")) {
    const matches = line.match(/\[etiquetas:\s*([^\]]+)\]/i);
    if (!matches?.[1]) continue;
    for (const value of matches[1].split(",")) {
      const clean = value.trim();
      if (clean) tags.add(clean);
    }
  }
  return Array.from(tags);
}

export function extractStateLabels(state: unknown): string[] {
  const record = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  if (!Array.isArray(record.labels)) return [];
  return record.labels.map((item) => String(item)).filter(Boolean);
}

export function includesAnyLabel(source: string[], selected: string[]): boolean {
  if (selected.length === 0) return true;
  const sourceSet = new Set(source.map((item) => item.toLowerCase()));
  return selected.some((label) => sourceSet.has(label.toLowerCase()));
}

export function toSeverity(value: unknown, fallback: Severity): Severity {
  return normalizeSeverity(value, fallback);
}
