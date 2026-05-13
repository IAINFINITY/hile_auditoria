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

  async function apiGet(pathname: string, query: Record<string, unknown> = {}): Promise<any> {
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
      throw new Error(`Chatwoot ${response.status} em ${pathname}. Body: ${text || "(vazio)"}`);
    }

    return response.json();
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
    const data = await apiGet(`/api/v1/accounts/${account}/conversations/${conversationId}/messages`);
    return Array.isArray(data?.payload) ? data.payload : [];
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
