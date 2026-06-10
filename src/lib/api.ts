const DEFAULT_TIMEOUT_MS = 240000;

export class ApiRequestError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code?: string | null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code || null;
  }
}

function isRetryableFetchError(error: unknown): boolean {
  const message = error instanceof Error ? String(error.message || "").toLowerCase() : String(error || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("networkerror") ||
    message.includes("failed to fetch")
  );
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (signal) {
    return signal;
  }

  return AbortSignal.timeout(timeoutMs);
}

export async function apiGet<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      signal: withTimeout(signal, timeoutMs),
    });
  } catch (error) {
    if (isRetryableFetchError(error)) {
      response = await fetch(url, {
        method: "GET",
        signal: withTimeout(signal, timeoutMs),
      });
    } else {
      throw error;
    }
  }

  const data = await response.json();
  if (!response.ok && response.status !== 207) {
    throw new ApiRequestError(data?.message || "Falha na requisicao", response.status, data?.error || null);
  }

  return data as T;
}

export async function apiPost<T>(
  url: string,
  body: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: withTimeout(signal, timeoutMs),
    });
  } catch (error) {
    if (isRetryableFetchError(error)) {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: withTimeout(signal, timeoutMs),
      });
    } else {
      throw error;
    }
  }

  const data = await response.json();
  if (!response.ok) {
    throw new ApiRequestError(data?.message || "Falha na requisicao", response.status, data?.error || null);
  }

  return data as T;
}
