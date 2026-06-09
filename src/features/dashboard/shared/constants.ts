import type { Severity } from "../../../types";

export const INSIGHTS_COLLAPSED_LIMIT = 5;

export const severityOrder: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export const severityLabel: Record<Severity, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
  info: "Informativo",
};

export const severityColors: Record<Severity, string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  medium: "var(--medium)",
  low: "var(--low)",
  info: "var(--info)",
};

export function normalizeSeverity(value: unknown, fallback: Severity = "info"): Severity {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (text.includes("crit")) return "critical";
  if (text.includes("alt")) return "high";
  if (text.includes("med")) return "medium";
  if (text.includes("baix")) return "low";
  if (text.includes("info")) return "info";
  return fallback;
}

export function severityDotClass(severity: Severity): string {
  if (severity === "critical") return "report-card-dot-critical";
  if (severity === "high") return "report-card-dot-high";
  if (severity === "medium") return "report-card-dot-medium";
  if (severity === "low") return "report-card-dot-low";
  return "report-card-dot-info";
}

export function severityBadgeClass(severity: Severity): string {
  if (severity === "critical") return "sev-critical";
  if (severity === "high") return "sev-high";
  if (severity === "medium") return "sev-medium";
  if (severity === "low") return "sev-low";
  return "sev-info";
}
