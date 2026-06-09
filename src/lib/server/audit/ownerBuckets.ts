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

export function resolveDedicatedHumanInboxOwner(inboxId: unknown): Exclude<ResponsibleBucket, "ia"> | null {
  const bucket = resolveInboxOwnerBucket(inboxId);
  return bucket === "ia" ? null : bucket;
}

export function enforceOwnerBucketByInbox(owner: unknown, inboxId: unknown): ResponsibleBucket {
  const inboxOwner = resolveDedicatedHumanInboxOwner(inboxId);
  if (inboxOwner) return inboxOwner;
  return normalizeResponsibleBucket(owner);
}

export function resolveResponsibleBucketBySenderName(
  senderName: unknown,
  inboxId: unknown,
): ResponsibleBucket | null {
  const normalized = String(senderName || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!normalized) return "ia";
  if (/\b(grupo|group|equipe|team|channel)\b/.test(normalized)) return null;
  if (/\bsamuel\b/.test(normalized)) return enforceOwnerBucketByInbox("samuel", inboxId);
  if (/\bsuelen\b|\bsuellen\b/.test(normalized)) return enforceOwnerBucketByInbox("suellen", inboxId);

  const looksLikeGenericInfinity =
    /\bacesso infinity\b|\bacesso_infinity\b|\bassistant\b|\bchatbot\b|\bbot\b|(^|\s)ia(\s|$)/.test(normalized);
  if (looksLikeGenericInfinity) {
    const inboxOwner = resolveDedicatedHumanInboxOwner(inboxId);
    if (inboxOwner) return inboxOwner;
    return "ia";
  }

  return "ia";
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
  const inboxOwner = resolveDedicatedHumanInboxOwner(inboxId);

  if (inboxOwner === "suellen") {
    return { ia: 0, suellen: ia + suellen + samuel, samuel: 0 };
  }
  if (inboxOwner === "samuel") {
    return { ia: 0, suellen: 0, samuel: ia + suellen + samuel };
  }
  return { ia: ia + suellen + samuel, suellen: 0, samuel: 0 };
}
