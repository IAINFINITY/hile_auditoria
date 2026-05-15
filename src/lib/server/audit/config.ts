import { readFileSync } from "node:fs";
import type { AppConfig } from "./types";

function parseValue(rawValue: string): string | number | boolean {
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;

  if (rawValue !== "" && !Number.isNaN(Number(rawValue))) {
    return Number(rawValue);
  }

  return rawValue;
}

export function loadEnvFile(path = ".env"): void {
  let content = "";

  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();

    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = String(parseValue(rawValue));
  }
}

export function getConfig(): AppConfig {
  return {
    port: Number(process.env.PORT || 3001),
    timezone: process.env.TIMEZONE || "America/Fortaleza",
    chatwoot: {
      baseUrl: (process.env.CHATWOOT_BASE_URL || "").replace(/\/$/, ""),
      apiToken: process.env.CHATWOOT_API_ACCESS_TOKEN || "",
      accountId: Number(process.env.CHATWOOT_ACCOUNT_ID || 0) || null,
      groupName: process.env.CHATWOOT_GROUP_NAME || "Grupo Botta",
      inboxName: process.env.CHATWOOT_INBOX_NAME || "Atendimento",
      inboxId: Number(process.env.CHATWOOT_INBOX_ID || 0) || null,
      inboxProvider: (process.env.CHATWOOT_INBOX_PROVIDER || "whatsapp").toLowerCase(),
      maxPages: Number(process.env.CHATWOOT_MAX_PAGES || 20),
      requestTimeoutMs: Number(process.env.CHATWOOT_REQUEST_TIMEOUT_MS || 45000),
    },
    dify: {
      baseUrl: (process.env.DIFY_BASE_URL || "https://api.dify.ai/v1").replace(/\/$/, ""),
      apiKey: process.env.DIFY_API_KEY || "",
      mode: (process.env.DIFY_MODE || "workflow").toLowerCase(),
      inputLogField: process.env.DIFY_INPUT_LOG_FIELD || "chat_log",
      userPrefix: process.env.DIFY_USER_PREFIX || "chatwoot-contact",
      requestTimeoutMs: Number(process.env.DIFY_REQUEST_TIMEOUT_MS || 90000),
    },
    incremental: {
      minRelevanceScore: Math.max(1, Number(process.env.INCREMENTAL_MIN_RELEVANCE_SCORE || 2)),
      unansweredMinutesThreshold: Math.max(5, Number(process.env.INCREMENTAL_UNANSWERED_MINUTES || 30)),
      fullRebaseDays: Math.max(1, Number(process.env.INCREMENTAL_FULL_REBASE_DAYS || 7)),
    },
  };
}

export function assertRequiredConfig(config: AppConfig): void {
  const missing: string[] = [];

  if (!config.chatwoot.baseUrl) missing.push("CHATWOOT_BASE_URL");
  if (!config.chatwoot.apiToken) missing.push("CHATWOOT_API_ACCESS_TOKEN");

  if (missing.length > 0) {
    throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(", ")}`);
  }
}
