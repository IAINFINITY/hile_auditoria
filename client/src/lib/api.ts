const DEFAULT_TIMEOUT_MS = 240000;

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (signal) {
    return signal;
  }

  return AbortSignal.timeout(timeoutMs);
}

export async function apiGet<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    signal: withTimeout(signal, timeoutMs),
  });

  const data = await response.json();
  if (!response.ok && response.status !== 207) {
    throw new Error(data?.message || "Falha na requisicao");
  }

  return data as T;
}

export async function apiPost<T>(
  url: string,
  body: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: withTimeout(signal, timeoutMs),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Falha na requisicao");
  }

  return data as T;
}
