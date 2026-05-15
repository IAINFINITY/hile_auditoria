function normalizeEpochSeconds(value: number): number {
  const n = Number(value || 0);
  if (!n || !Number.isFinite(n)) return 0;
  // Handles APIs returning milliseconds instead of seconds.
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

export function toYmdInTimezone(unixSeconds: number, timeZone: string): string {
  const safeUnix = normalizeEpochSeconds(unixSeconds);
  const date = new Date(safeUnix * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((item) => item.type === "year")?.value;
  const month = parts.find((item) => item.type === "month")?.value;
  const day = parts.find((item) => item.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

export function todayYmd(timeZone: string): string {
  const now = Date.now() / 1000;
  return toYmdInTimezone(now, timeZone);
}

export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function formatDateTimeInTimezone(unixSeconds: number | null, timeZone: string): string | null {
  if (!unixSeconds) return null;
  const safeUnix = normalizeEpochSeconds(unixSeconds);
  const date = new Date(safeUnix * 1000);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function assertYmd(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error("Data invalida. Use o formato YYYY-MM-DD.");
  }
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter((item) => item !== null && item !== undefined && item !== ""))] as T[];
}
