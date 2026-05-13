export function toDateInputValue(date = new Date()): string {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

export function isValidDateInput(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function normalizeDateInput(value: string, fallback: string): string {
  return isValidDateInput(value) ? value : fallback;
}

export function clampDateInput(value: string, min: string, max: string): string {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function normalizeChatwootAppBase(baseUrl?: string): string {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    const cleanPath = parsed.pathname
      .replace(/\/+$/, "")
      .replace(/\/api\/v1(?:\/.*)?$/i, "")
      .replace(/\/api(?:\/.*)?$/i, "");
    return `${parsed.origin}${cleanPath}`.replace(/\/+$/, "");
  } catch {
    return raw
      .replace(/\/+$/, "")
      .replace(/\/api\/v1(?:\/.*)?$/i, "")
      .replace(/\/api(?:\/.*)?$/i, "");
  }
}

export function buildConversationUrl(baseUrl: string, accountId: number, inboxId: number, conversationId: number): string {
  return `${baseUrl}/app/accounts/${accountId}/inbox/${inboxId}/conversations/${conversationId}`;
}

export function parseHour(value: string | null | undefined): number | null {
  if (!value) return null;

  const fromDate = new Date(value);
  if (!Number.isNaN(fromDate.getTime())) {
    return fromDate.getHours();
  }

  const hhmm = value.match(/(\d{1,2}):(\d{2})/);
  if (!hhmm) return null;

  const hour = Number(hhmm[1]);
  if (Number.isNaN(hour) || hour < 0 || hour > 23) return null;
  return hour;
}
