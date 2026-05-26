function stripWrappingCodeFence(raw: string): string {
  const trimmed = String(raw || "").trim();
  const wrapped = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (!wrapped?.[1]) return trimmed;
  return wrapped[1].trim();
}

function extractFirstBalancedJsonBlock(raw: string): string | null {
  const text = String(raw || "");
  if (!text) return null;

  const starts: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{" || ch === "[") starts.push(i);
  }

  const matches = (open: string, close: string) => (open === "{" && close === "}") || (open === "[" && close === "]");

  for (const start of starts) {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let invalid = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") {
          inString = false;
        }
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }

      if (ch === "{" || ch === "[") {
        stack.push(ch);
        continue;
      }

      if (ch === "}" || ch === "]") {
        const open = stack.pop();
        if (!open || !matches(open, ch)) {
          invalid = true;
          break;
        }
        if (stack.length === 0) {
          return text.slice(start, i + 1).trim();
        }
      }
    }

    if (invalid) continue;
  }

  return null;
}

export function parseLooseJson(value: unknown): unknown | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const candidates: string[] = [];
  const push = (candidate: string | null | undefined) => {
    const clean = String(candidate || "").trim();
    if (!clean) return;
    if (!candidates.includes(clean)) candidates.push(clean);
  };

  push(raw);
  push(stripWrappingCodeFence(raw));

  const fencedAny = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  push(fencedAny?.[1]);

  push(extractFirstBalancedJsonBlock(raw));
  push(extractFirstBalancedJsonBlock(stripWrappingCodeFence(raw)));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }

  return null;
}

export function parseLooseJsonObject(value: unknown): Record<string, unknown> | null {
  const parsed = parseLooseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

