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
}

export function createDifyClient({
  baseUrl,
  apiKey,
  mode = "workflow",
  inputLogField = "chat_log",
  userPrefix = "chatwoot-contact",
  requestTimeoutMs = 90000,
}: DifyConfig) {
  const normalizedBaseUrl = normalizeDifyBaseUrl(baseUrl);

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
        const error = new Error(
          "Dify retornou 'Workflow not published'. Publique a app/workflow no Dify antes de chamar a API.",
        ) as ErrorWithMeta;
        error.status = response.status;
        error.code = "workflow_not_published";
        error.body = text;
        throw error;
      }

      const error = new Error(`Dify ${response.status} em ${pathname}. Body: ${text || "(vazio)"}`) as ErrorWithMeta;
      error.status = response.status;
      error.code = parsed?.code || null;
      error.body = text;
      throw error;
    }

    return response.json();
  }

  async function analyzeLog({ contactKey, date, logText }: AnalyzeInput): Promise<any> {
    const user = `${userPrefix}-${contactKey || "unknown"}`;

    if (mode === "chat") {
      const prompt = [
        `Data de referência: ${date}`,
        "Analise o log abaixo e identifique pontos de melhoria e gaps operacionais.",
        "Retorne somente JSON válido com as chaves: resumo, pontos_melhoria[], gaps_operacionais[], risco_critico, proximos_passos[].",
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
        inputs: {},
      });
    }

    return request("/workflows/run", {
      user,
      response_mode: "blocking",
      inputs: {
        date,
        [inputLogField]: logText,
      },
    });
  }

  async function testConnection(): Promise<{ ok: boolean; message?: string; status?: number | null; code?: string | null }> {
    try {
      if (mode === "chat") {
        await request("/chat-messages", {
          query: "teste de conexão",
          user: "health-check",
          response_mode: "blocking",
          inputs: {},
        });
      } else {
        await request("/workflows/run", {
          user: "health-check",
          response_mode: "blocking",
          inputs: {},
        });
      }
      return { ok: true };
    } catch (error) {
      const err = error as ErrorWithMeta;
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
    testConnection,
  };
}
