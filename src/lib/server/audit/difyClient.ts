import { createHash } from "node:crypto";
import type { DifyConfig, ErrorWithMeta } from "./types";

function normalizeDifyBaseUrl(rawBaseUrl: string): string {
  const raw = String(rawBaseUrl || "").trim();
  if (!raw) return "";

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw.replace(/\/$/, "");
  }

  const path = parsed.pathname.replace(/\/$/, "");

  if (!path || path === "") {
    return `${parsed.origin}/v1`;
  }

  if (path === "/v1" || path.startsWith("/v1/")) {
    return `${parsed.origin}/v1`;
  }

  if (path.startsWith("/chat/")) {
    return `${parsed.origin}/v1`;
  }

  return `${parsed.origin}${path}`;
}

interface AnalyzeInput {
  contactKey: string;
  date: string;
  logText: string;
  analysisMode?: "full" | "delta";
  extraInputs?: Record<string, unknown>;
}

interface RecoverFromHistoryInput {
  user: string;
  date: string;
  sourceFingerprint: string;
  logText: string;
}

interface DifyHealthResult {
  ok: boolean;
  message?: string;
  status?: number | null;
  code?: string | null;
}

interface HistoryCandidate {
  answer: string;
  conversation_id?: string;
  message_id?: string;
  created_at: number;
}

export function createDifyClient({
  baseUrl,
  apiKey,
  mode = "workflow",
  inputLogField = "chat_log",
  userPrefix = "chatwoot-contact",
  requestTimeoutMs = 90000,
  timezone = "America/Sao_Paulo",
}: DifyConfig) {
  const normalizedBaseUrl = normalizeDifyBaseUrl(baseUrl);

  function sha256(value: string): string {
    return createHash("sha256").update(String(value || "")).digest("hex");
  }

  function extractPromptLogText(query: string): string {
    const normalized = String(query || "");
    const marker = "\nLOG:\n";
    const idx = normalized.indexOf(marker);
    if (idx === -1) return "";
    return normalized.slice(idx + marker.length).trim();
  }

  function normalizeUnixSeconds(value: unknown): number {
    const n = Number(value || 0);
    if (!n || !Number.isFinite(n)) return 0;
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }

  function toYmdInTimezone(unixValue: unknown): string | null {
    const unixSeconds = normalizeUnixSeconds(unixValue);
    if (!unixSeconds) return null;

    const date = new Date(unixSeconds * 1000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const year = parts.find((item) => item.type === "year")?.value;
    const month = parts.find((item) => item.type === "month")?.value;
    const day = parts.find((item) => item.type === "day")?.value;
    if (!year || !month || !day) return null;
    return `${year}-${month}-${day}`;
  }

  function parseAnalysisKeyFromUser(user: string): string {
    const raw = String(user || "").trim();
    const prefix = `${userPrefix}-`;
    if (!raw.startsWith(prefix)) return raw;
    return raw.slice(prefix.length).trim();
  }

  function parseConversationIdFromAnalysisKey(analysisKey: string): number | null {
    const match = String(analysisKey || "").match(/::conversation-(\d+)/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function queryLooksLikeSameConversation(query: string, expectedConversationId: number): boolean {
    const q = String(query || "");
    const id = String(expectedConversationId);
    if (!q) return false;
    return (
      q.includes(`conversation-${id}`) ||
      q.includes(`conversation ${id}`) ||
      q.includes(`conversa ${id}`) ||
      q.includes(`CONVERSATION_ID: ${id}`) ||
      q.includes(`conversation_id: ${id}`)
    );
  }

  async function request(pathname: string, body: Record<string, unknown>): Promise<any> {
    const response = await fetch(`${normalizedBaseUrl}${pathname}`, {
      method: "POST",
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {}

      if (response.status === 400 && text.includes("Workflow not published")) {
        const error = new Error("Dify returned 'Workflow not published'. Publish the workflow before calling the API.") as ErrorWithMeta;
        error.status = response.status;
        error.code = "workflow_not_published";
        error.body = text;
        throw error;
      }

      const error = new Error(`Dify ${response.status} in ${pathname}. Body: ${text || "(empty)"}`) as ErrorWithMeta;
      error.status = response.status;
      error.code = parsed?.code || null;
      error.body = text;
      throw error;
    }

    return response.json();
  }

  async function requestGet(pathname: string, queryParams: Record<string, unknown>): Promise<any> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams || {})) {
      if (value === null || value === undefined || value === "") continue;
      query.set(key, String(value));
    }

    const url = `${normalizedBaseUrl}${pathname}${query.size > 0 ? `?${query.toString()}` : ""}`;
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {}

      const error = new Error(`Dify ${response.status} in ${pathname}. Body: ${text || "(empty)"}`) as ErrorWithMeta;
      error.status = response.status;
      error.code = parsed?.code || null;
      error.body = text;
      throw error;
    }

    return response.json();
  }

  async function listConversations(user: string, limit = 20): Promise<any[]> {
    const payload = await requestGet("/conversations", {
      user,
      limit: Math.max(1, Math.min(100, limit)),
      sort_by: "-updated_at",
    });
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  async function listMessages(conversationId: string, user: string, limit = 50): Promise<any[]> {
    const payload = await requestGet("/messages", {
      conversation_id: conversationId,
      user,
      limit: Math.max(1, Math.min(100, limit)),
    });
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  async function recoverAnalysisFromHistory({
    user,
    date,
    sourceFingerprint,
    logText,
  }: RecoverFromHistoryInput): Promise<{ answer: string; conversation_id?: string; message_id?: string } | null> {
    const conversations = await listConversations(user, 25);
    if (conversations.length === 0) return null;

    const fallbackNeedle = String(logText || "").trim().slice(0, 120);
    const expectedAnalysisKey = parseAnalysisKeyFromUser(user);
    const expectedConversationId = parseConversationIdFromAnalysisKey(expectedAnalysisKey);
    const candidates: HistoryCandidate[] = [];

    for (const conversation of conversations.slice(0, 15)) {
      const conversationId = String(conversation?.id || "").trim();
      if (!conversationId) continue;

      const conversationCreatedYmd = toYmdInTimezone(conversation?.created_at);
      const conversationUpdatedYmd = toYmdInTimezone(conversation?.updated_at);

      const messages = await listMessages(conversationId, user, 50);
      for (const message of messages) {
        const query = String(message?.query || "").trim();
        const answer = String(message?.answer || "").trim();
        if (!answer) continue;

        const messageCreatedYmd = toYmdInTimezone(message?.created_at);
        const queryReferencesDate =
          query.includes(`Data de referencia: ${date}`) ||
          query.includes(`Data de referência: ${date}`) ||
          query.includes(date);

        const belongsToDate =
          messageCreatedYmd === date ||
          conversationCreatedYmd === date ||
          conversationUpdatedYmd === date ||
          queryReferencesDate;

        if (!belongsToDate) continue;

        if (expectedConversationId && query) {
          const sameConversation = queryLooksLikeSameConversation(query, expectedConversationId);
          if (!sameConversation) continue;
        }

        const promptLogText = extractPromptLogText(query);
        let matched = false;

        if (promptLogText) {
          matched = sha256(promptLogText) === sourceFingerprint;
        } else if (fallbackNeedle) {
          matched = query.includes(fallbackNeedle);
        }

        // Workflow executions may not preserve the full prompt query.
        if (!matched && !query && messageCreatedYmd === date) {
          matched = true;
        }

        if (!matched) continue;

        const createdAt = normalizeUnixSeconds(message?.created_at);
        candidates.push({
          answer,
          conversation_id: conversationId,
          message_id: String(message?.id || "").trim() || undefined,
          created_at: createdAt,
        });
      }
    }

    if (candidates.length === 0) return null;

    // Dedup by Dify message id first, then keep the most recent candidate.
    const deduped = new Map<string, HistoryCandidate>();
    for (const item of candidates) {
      const key = item.message_id || `${item.conversation_id || "no-conversation"}:${item.created_at}`;
      const current = deduped.get(key);
      if (!current || item.created_at > current.created_at) {
        deduped.set(key, item);
      }
    }

    const best = [...deduped.values()].sort((a, b) => b.created_at - a.created_at)[0];
    return {
      answer: best.answer,
      conversation_id: best.conversation_id,
      message_id: best.message_id,
    };
  }

  async function requestChatHealth(): Promise<void> {
    await request("/chat-messages", {
      query: "connection test",
      user: "health-check",
      response_mode: "blocking",
      inputs: {},
    });
  }

  async function requestWorkflowHealth(): Promise<void> {
    await request("/workflows/run", {
      user: "health-check",
      response_mode: "blocking",
      inputs: {},
    });
  }

  async function analyzeLog({ contactKey, date, logText, analysisMode = "full", extraInputs = {} }: AnalyzeInput): Promise<any> {
    const user = `${userPrefix}-${contactKey || "unknown"}`;

    if (mode === "chat") {
      const prompt = [
        `Data de referencia: ${date}`,
        "Analise o log abaixo e identifique pontos de melhoria e gaps operacionais.",
        "Retorne somente JSON valido com as chaves: resumo, pontos_melhoria[], gaps_operacionais[], risco_critico, proximos_passos[].",
        "Cada item de gaps_operacionais[] deve conter: nome_gap, severidade, descricao, mensagem_referencia.",
        "Em mensagem_referencia, inclua trecho literal da mensagem e/ou timestamp da conversa (nunca deixe vazio).",
        "",
        "LOG:",
        logText,
      ].join("\n");

      return request("/chat-messages", {
        query: prompt,
        user,
        response_mode: "blocking",
        inputs: {
          analysis_mode: analysisMode,
          ...extraInputs,
        },
      });
    }

    return request("/workflows/run", {
      user,
      response_mode: "blocking",
      inputs: {
        analysis_mode: analysisMode,
        date,
        [inputLogField]: logText,
        ...extraInputs,
      },
    });
  }

  async function testConnection(): Promise<DifyHealthResult> {
    try {
      if (mode === "chat") {
        await requestChatHealth();
        return { ok: true };
      }

      await requestWorkflowHealth();
      return { ok: true };
    } catch (error) {
      const err = error as ErrorWithMeta;

      // If workflow health fails because it is not published, try chat endpoint.
      if (mode === "workflow" && err.code === "workflow_not_published") {
        try {
          await requestChatHealth();
          return {
            ok: true,
            message: "Workflow not published, but chat endpoint is healthy. Consider setting DIFY_MODE=chat.",
            status: err.status || null,
            code: err.code || null,
          };
        } catch {
          // keep original error below
        }
      }

      return {
        ok: false,
        message: err.message,
        status: err.status || null,
        code: err.code || null,
      };
    }
  }

  return {
    analyzeLog,
    recoverAnalysisFromHistory,
    testConnection,
  };
}
