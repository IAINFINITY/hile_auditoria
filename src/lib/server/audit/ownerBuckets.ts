export type ResponsibleBucket = "ia" | "suellen" | "samuel";

export function normalizeResponsibleBucket(value: unknown): ResponsibleBucket {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "suellen" || normalized === "samuel") return normalized;
  return "ia";
}

export function resolveInboxOwnerBucket(inboxId: unknown): ResponsibleBucket {
  const id = Number(inboxId || 0);
  if (id === 125) return "suellen";
  if (id === 155) return "samuel";
  return "ia";
}

export function enforceOwnerBucketByInbox(owner: unknown, inboxId: unknown): ResponsibleBucket {
  const normalizedOwner = normalizeResponsibleBucket(owner);
  if (normalizedOwner === "ia") return "ia";
  const inboxOwner = resolveInboxOwnerBucket(inboxId);
  return inboxOwner === normalizedOwner ? normalizedOwner : "ia";
}

export function sanitizeBreakdownByInbox(
  rawBreakdown: unknown,
  inboxId: unknown,
): { ia: number; suellen: number; samuel: number } {
  const breakdownObj =
    rawBreakdown && typeof rawBreakdown === "object" && !Array.isArray(rawBreakdown)
      ? (rawBreakdown as Record<string, unknown>)
      : null;

  const ia = Math.max(0, Number(breakdownObj?.ia || 0) || 0);
  const suellen = Math.max(0, Number(breakdownObj?.suellen || 0) || 0);
  const samuel = Math.max(0, Number(breakdownObj?.samuel || 0) || 0);
  const inboxOwner = resolveInboxOwnerBucket(inboxId);

  if (inboxOwner === "suellen") {
    return { ia: ia + samuel, suellen, samuel: 0 };
  }
  if (inboxOwner === "samuel") {
    return { ia: ia + suellen, suellen: 0, samuel };
  }
  return { ia: ia + suellen + samuel, suellen: 0, samuel: 0 };
}
