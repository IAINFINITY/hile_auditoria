import { assertRequiredConfig, getConfig } from "@/lib/server/audit/config";
import { assertYmd, todayYmd } from "@/lib/server/audit/dateUtils";

let cachedConfig: ReturnType<typeof getConfig> | null = null;

export function getAppConfig() {
  if (!cachedConfig) {
    cachedConfig = getConfig();
    assertRequiredConfig(cachedConfig);
  }
  return cachedConfig;
}

export function parseDateInput(inputDate: string | undefined | null, timezone: string): string {
  const date = inputDate || todayYmd(timezone);
  assertYmd(date);
  return date;
}

export async function readJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    return (body || {}) as T;
  } catch {
    throw new Error("Body JSON inválido.");
  }
}
