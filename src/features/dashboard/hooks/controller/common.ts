import type { Severity } from "../../../../types";

export type ReportSeverityFilter = "all" | "critical" | "high" | "medium" | "low";

export function normalizeTextForMatch(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function toTitleCaseName(value: unknown): string {
  const input = String(value || "").trim();
  if (!input) return "";

  return input
    .split(/\s+/)
    .map((word) =>
      word
        .split("-")
        .map((part) => {
          if (!part) return part;
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join("-"),
    )
    .join(" ");
}

export function inferSeverityFromValue(value: unknown, fallback: Severity = "info"): Severity {
  const text = normalizeTextForMatch(value);
  if (!text) return fallback;
  if (text.includes("crit")) return "critical";
  if (text.includes("alt")) return "high";
  if (text.includes("med")) return "medium";
  if (text.includes("baix")) return "low";
  if (text.includes("info")) return "info";
  return fallback;
}

export function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

export function toChatwootAppBase(baseUrl: string): string {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "").replace(/\/api\/v1(?:\/.*)?$/i, "").replace(/\/api(?:\/.*)?$/i, "");
}

export function buildConversationLink(
  baseUrl: string,
  accountId: number,
  inboxId: number,
  conversationId: number,
): string | null {
  if (!baseUrl || !accountId || !inboxId || !conversationId) return null;
  return `${baseUrl}/app/accounts/${accountId}/inbox/${inboxId}/conversations/${conversationId}`;
}

export function addDays(baseDate: Date, days: number): Date {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

export function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asString(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "1" || text === "sim";
}

export function parseJsonObject(text: unknown): Record<string, unknown> {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function parseHourlyRolesFromLogText(logText: unknown): Array<{ hour: number; role: "USER" | "AGENT" }> {
  const lines = String(logText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed: Array<{ hour: number; role: "USER" | "AGENT" }> = [];

  for (const line of lines) {
    const upper = line.toUpperCase();
    let role: "USER" | "AGENT" | null = null;

    if (/\b(AGENT|ASSISTANT|ATENDENTE|BOT|AI|IA|ACESSO_INFINITY|ACESSO INFINITY)\b/.test(upper)) {
      role = "AGENT";
    } else if (/\b(USER|USUARIO|USUÁRIO|CLIENTE|CONTACT)\b/.test(upper)) {
      role = "USER";
    }
    if (!role || upper.includes("SYSTEM_PRIVATE")) continue;

    const tsMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/);
    let date: Date | null = null;
    if (tsMatch?.[1]) {
      date = new Date(tsMatch[1]);
    } else {
      const shortHourMatch = line.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
      if (shortHourMatch?.[0]) {
        const normalizedTime = shortHourMatch[0].length === 5 ? `${shortHourMatch[0]}:00` : shortHourMatch[0];
        const fallback = new Date();
        const [hour, minute, second] = normalizedTime.split(":").map((part) => Number(part || 0));
        fallback.setHours(hour || 0, minute || 0, second || 0, 0);
        date = fallback;
      }
      if (!date) {
        const brDateTimeMatch = line.match(/\b(\d{2})\/(\d{2})\/(\d{4}),\s*([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
        if (brDateTimeMatch) {
          const [, d, m, y, hh, mm, ss] = brDateTimeMatch;
          date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss || 0));
        }
      }
    }
    if (!date || Number.isNaN(date.getTime())) continue;

    parsed.push({ hour: date.getHours(), role });
  }

  return parsed;
}
