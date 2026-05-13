export function toYmdInTimezone(unixSeconds: number, timeZone: string): string {
  const date = new Date(Number(unixSeconds || 0) * 1000);
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
  const date = new Date(Number(unixSeconds) * 1000);
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
    throw new Error("Data inválida. Use o formato YYYY-MM-DD.");
  }
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values.filter((item) => item !== null && item !== undefined && item !== ""))] as T[];
}
