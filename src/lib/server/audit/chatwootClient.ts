function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.append(key, String(value));
  }

  const raw = params.toString();
  return raw ? `?${raw}` : "";
}

interface ChatwootClientInput {
  baseUrl: string;
  apiAccessToken: string;
  accountId: number | null;
  timeoutMs?: number;
}

export function createChatwootClient({ baseUrl, apiAccessToken, accountId, timeoutMs = 45000 }: ChatwootClientInput) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const maxRetries = 5;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  function isRetryableNetworkError(error: unknown): boolean {
    const code = String((error as { code?: string } | null)?.code || "").toUpperCase();
    const message = String((error as Error | null)?.message || "").toLowerCase();
    if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "EAI_AGAIN") return true;
    if (code.includes("UND_ERR_CONNECT_TIMEOUT")) return true;
    return (
      message.includes("fetch failed") ||
      message.includes("connect timeout") ||
      message.includes("econnreset") ||
      message.includes("network")
    );
  }

  function isRetryableHttpStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 504);
  }

  async function apiGet(pathname: string, query: Record<string, unknown> = {}): Promise<any> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetch(`${normalizedBaseUrl}${pathname}${buildQueryString(query)}`, {
          method: "GET",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            "Content-Type": "application/json",
            api_access_token: apiAccessToken,
          },
        });

        if (!response.ok) {
          const text = await response.text();
          if (attempt < maxRetries && isRetryableHttpStatus(response.status)) {
            await sleep(500 * attempt);
            continue;
          }
          throw new Error(`Chatwoot ${response.status} em ${pathname}. Body: ${text || "(vazio)"}`);
        }

        return response.json();
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries && isRetryableNetworkError(error)) {
          await sleep(500 * attempt);
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Falha de rede ao consultar Chatwoot.");
  }

  async function listInboxes(): Promise<any[]> {
    if (!accountId) {
      throw new Error("accountId ausente para listInboxes.");
    }
    const data = await apiGet(`/api/v1/accounts/${accountId}/inboxes`);
    return Array.isArray(data?.payload) ? data.payload : [];
  }

  async function getProfile(): Promise<any> {
    return apiGet("/api/v1/profile");
  }

  async function listInboxesByAccount(targetAccountId: number): Promise<any[]> {
    const account = Number(targetAccountId || 0);
    if (!account) {
      throw new Error("accountId ausente para listInboxesByAccount.");
    }

    const data = await apiGet(`/api/v1/accounts/${account}/inboxes`);
    return Array.isArray(data?.payload) ? data.payload : [];
  }

  async function listConversationsPage({
    inboxId,
    page,
    status = "all",
    accountId: accountIdOverride,
  }: {
    inboxId: number;
    page: number;
    status?: string;
    accountId: number;
  }): Promise<any[]> {
    const account = Number(accountIdOverride || accountId || 0);
    if (!account) {
      throw new Error("accountId ausente para listConversationsPage.");
    }

    const data = await apiGet(`/api/v1/accounts/${account}/conversations`, {
      inbox_id: inboxId,
      status,
      assignee_type: "all",
      page,
    });

    const payload = data?.data?.payload;
    return Array.isArray(payload) ? payload : [];
  }

  async function getConversation(conversationId: number, accountIdOverride: number): Promise<any> {
    const account = Number(accountIdOverride || accountId || 0);
    if (!account) {
      throw new Error("accountId ausente para getConversation.");
    }
    return apiGet(`/api/v1/accounts/${account}/conversations/${conversationId}`);
  }

  async function getConversationMessages(conversationId: number, accountIdOverride: number): Promise<any[]> {
    const account = Number(accountIdOverride || accountId || 0);
    if (!account) {
      throw new Error("accountId ausente para getConversationMessages.");
    }
    const collected: any[] = [];
    const seenIds = new Set<number>();
    let beforeId: number | null = null;
    let safety = 0;

    // Chatwoot devolve mensagens mais recentes; usamos `before` para paginar para trás.
    while (safety < 50) {
      safety += 1;
      const query = beforeId ? { before: beforeId } : {};
      const data = await apiGet(`/api/v1/accounts/${account}/conversations/${conversationId}/messages`, query);
      const batch = Array.isArray(data?.payload) ? data.payload : [];
      if (batch.length === 0) break;

      let minBatchId = Number.MAX_SAFE_INTEGER;
      let appended = 0;

      for (const message of batch) {
        const id = Number(message?.id || 0);
        if (id > 0) {
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          minBatchId = Math.min(minBatchId, id);
        }
        collected.push(message);
        appended += 1;
      }

      if (appended === 0) break;
      if (!Number.isFinite(minBatchId) || minBatchId === Number.MAX_SAFE_INTEGER) break;

      const nextBefore = minBatchId;
      if (beforeId !== null && nextBefore >= beforeId) break;
      beforeId = nextBefore;
    }

    return collected;
  }

  return {
    getProfile,
    listInboxes,
    listInboxesByAccount,
    listConversationsPage,
    getConversation,
    getConversationMessages,
  };
}
