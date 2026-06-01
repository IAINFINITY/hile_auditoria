import "server-only";

type RateLimiterEntry = {
  blockedUntil: number;
  attempts: number[];
};

const limiterStore = new Map<string, RateLimiterEntry>();

export function getRequestIp(request: Request): string {
  const forwardedFor = String(request.headers.get("x-forwarded-for") || "").trim();
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return "unknown";
}

export function getRequestUserAgent(request: Request): string {
  return String(request.headers.get("user-agent") || "").trim().slice(0, 360);
}

export function getRequestOrigin(request: Request): string {
  return String(request.headers.get("origin") || "").trim().toLowerCase();
}

export function getRequestHost(request: Request): string {
  return String(request.headers.get("x-forwarded-host") || request.headers.get("host") || "")
    .trim()
    .toLowerCase();
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = getRequestOrigin(request);
  if (!origin) return false;
  const host = getRequestHost(request);
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export function consumeRateLimit(input: {
  key: string;
  nowMs?: number;
  windowMs: number;
  maxAttempts: number;
  blockMs: number;
}) {
  const now = Number(input.nowMs || Date.now());
  const key = String(input.key || "").trim();
  if (!key) {
    return { allowed: false, retryAfterSec: Math.ceil(input.blockMs / 1000), remaining: 0 };
  }

  const current = limiterStore.get(key) || { blockedUntil: 0, attempts: [] };
  if (current.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((current.blockedUntil - now) / 1000)),
      remaining: 0,
    };
  }

  const attempts = current.attempts.filter((ts) => now - ts <= input.windowMs);
  attempts.push(now);

  if (attempts.length > input.maxAttempts) {
    const blockedUntil = now + input.blockMs;
    limiterStore.set(key, { blockedUntil, attempts });
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(input.blockMs / 1000)),
      remaining: 0,
    };
  }

  limiterStore.set(key, { blockedUntil: 0, attempts });
  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: Math.max(0, input.maxAttempts - attempts.length),
  };
}
