import type { Severity } from "../../../types";

export const INSIGHTS_COLLAPSED_LIMIT = 8;

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
  info: "Informação",
};

export const severityColors: Record<Severity, string> = {
  critical: "#ff3b3b",
  high: "#ff8a1f",
  medium: "#ffd400",
  low: "#3fd47a",
  info: "#5aa8ff",
};
