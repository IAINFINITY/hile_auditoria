import type { AnalysisItem } from "../../../../types";
import type { OperationalAlertItem, ProductDemandItem } from "../../shared/types";

type ParsedMessage = {
  role: "USER" | "AGENT" | "SYSTEM";
  content: string;
  timestamp: Date | null;
};

function tryParseJson(text: string): Record<string, unknown> | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {}
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  if (!fenced?.[1]) return null;
  try {
    const parsed = JSON.parse(fenced[1]);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const PRODUCT_ALIASES: Record<string, string[]> = {
  Whey: ["whey", "uei", "wehy"],
  Creatina: ["creatina", "creatine", "creatin", "creatna"],
  "Pré-treino": ["pre treino", "pre-treino", "pretreino", "pre treino", "preworkout", "pré treino", "pré-treino"],
  Colageno: ["colageno", "colágeno", "collagen"],
  "Suplementos fitness": ["suplemento", "suplementos", "fitness"],
};

const CONSULTOR_KEYWORDS = [
  "consultor",
  "atendente",
  "vendedor",
  "humano",
  "pessoa real",
  "falar com alguem",
  "falar com alguém",
  "quero atendimento humano",
];

const DISENGAGEMENT_KEYWORDS = [
  "atrasando",
  "demora",
  "ruim",
  "péssimo",
  "pessimo",
  "nao gostei",
  "não gostei",
  "desisti",
  "vou procurar outra",
  "falar mal",
];

function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function inferRole(token: string): "USER" | "AGENT" | "SYSTEM" {
  const t = normalizeText(token);
  if (/(^|[^a-z])(user|usuario|cliente|contact)([^a-z]|$)/.test(t)) return "USER";
  if (/(^|[^a-z])(agent|assistant|atendente|bot|ia|acesso infinity|acesso_infinity)([^a-z]|$)/.test(t)) return "AGENT";
  return "SYSTEM";
}

function parseTimestamp(text: string): Date | null {
  const bracketIso = text.match(/\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/);
  if (bracketIso?.[1]) {
    const d = new Date(bracketIso[1]);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const br = text.match(/\b(\d{2})\/(\d{2})\/(\d{4}),?\s+([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
  if (br) {
    const [, dd, mm, yyyy, hh, min, ss] = br;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss || 0));
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

export function parseLogMessages(logText: string): ParsedMessage[] {
  const lines = String(logText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const out: ParsedMessage[] = [];
  for (const line of lines) {
    const match = line.match(/^\[(.*?)\]\s*([A-Z_À-ÿ ]+)\s*[:\-]\s*(.*)$/i);
    if (match) {
      out.push({
        role: inferRole(match[2]),
        content: String(match[3] || "").trim(),
        timestamp: parseTimestamp(line),
      });
      continue;
    }

    const altMatch = line.match(/^([A-Z_À-ÿ ]+)\s*[:\-]\s*(.*)$/i);
    if (altMatch) {
      out.push({
        role: inferRole(altMatch[1]),
        content: String(altMatch[2] || "").trim(),
        timestamp: parseTimestamp(line),
      });
    }
  }
  return out;
}

export function buildClientResponseStats(analyses: AnalysisItem[]) {
  let waitingSince: Date | null = null;
  const delaysSeconds: number[] = [];
  const userHours = new Array<number>(24).fill(0);
  const structuredDelays: Array<{ seconds: number; samples: number }> = [];
  const structuredPeak = new Map<string, number>();

  for (const analysis of analyses || []) {
    const messages = parseLogMessages(String(analysis.log_text || ""));
    for (const msg of messages) {
      if (msg.role === "AGENT" && msg.timestamp) {
        waitingSince = msg.timestamp;
        continue;
      }
      if (msg.role === "USER" && msg.timestamp) {
        userHours[msg.timestamp.getHours()] += 1;
        if (waitingSince) {
          const delta = Math.floor((msg.timestamp.getTime() - waitingSince.getTime()) / 1000);
          if (delta >= 0) delaysSeconds.push(delta);
          waitingSince = null;
        }
      }
    }

    const parsed = tryParseJson(String(analysis.analysis?.answer || ""));
    const metricasCliente =
      parsed && typeof parsed.metricas_cliente === "object" && parsed.metricas_cliente
        ? (parsed.metricas_cliente as Record<string, unknown>)
        : null;
    const sec = Number(metricasCliente?.tempo_medio_resposta_seg || 0);
    const samples = Number(metricasCliente?.amostragem_respostas || metricasCliente?.total_mensagens || 0);
    if (sec > 0) {
      structuredDelays.push({ seconds: sec, samples: samples > 0 ? samples : 1 });
    }
    const peakLabel = String(metricasCliente?.hora_pico_resposta || "").trim();
    if (peakLabel) {
      structuredPeak.set(peakLabel, Number(structuredPeak.get(peakLabel) || 0) + 1);
    }
  }

  const avgSecondsFromLog =
    delaysSeconds.length > 0
      ? Math.round(delaysSeconds.reduce((acc, value) => acc + value, 0) / delaysSeconds.length)
      : 0;
  const structuredTotalSamples = structuredDelays.reduce((acc, item) => acc + item.samples, 0);
  const avgSecondsFromStructured =
    structuredTotalSamples > 0
      ? Math.round(
          structuredDelays.reduce((acc, item) => acc + item.seconds * item.samples, 0) / structuredTotalSamples,
        )
      : 0;
  const avgSeconds = avgSecondsFromStructured > 0 ? avgSecondsFromStructured : avgSecondsFromLog;

  let peakHour = -1;
  let peakCount = 0;
  for (let i = 0; i < userHours.length; i += 1) {
    if (userHours[i] > peakCount) {
      peakCount = userHours[i];
      peakHour = i;
    }
  }

  let structuredPeakLabel = "";
  let structuredPeakCount = 0;
  for (const [label, count] of structuredPeak.entries()) {
    if (count > structuredPeakCount) {
      structuredPeakCount = count;
      structuredPeakLabel = label;
    }
  }

  return {
    averageMinutesLabel: avgSeconds > 0 ? `${(avgSeconds / 60).toFixed(1)} min` : "0.0 min",
    peakHourLabel:
      peakHour >= 0
        ? `${String(peakHour).padStart(2, "0")}h (${peakCount})`
        : structuredPeakLabel || "-",
    sampleCount: delaysSeconds.length + structuredTotalSamples,
  };
}

export function extractProductDemand(analyses: AnalysisItem[]): ProductDemandItem[] {
  const counters = new Map<string, { count: number; contacts: Set<string> }>();
  for (const analysis of analyses || []) {
    const contactKey = String(analysis.contact_key || "").trim() || "contato";
    const seenInAnalysis = new Set<string>();
    const parsed = tryParseJson(String(analysis.analysis?.answer || ""));
    const structuredProducts = Array.isArray(parsed?.produtos_citados)
      ? (parsed?.produtos_citados as Array<Record<string, unknown>>)
      : [];

    for (const product of structuredProducts) {
      const candidate = String(product?.nome_produto || product?.termo_detectado || "").trim();
      if (!candidate) continue;
      const display = candidate
        .replace(/_/g, " ")
        .replace(/\b\w/g, (match) => match.toUpperCase());
      if (seenInAnalysis.has(display)) continue;
      seenInAnalysis.add(display);
      const current = counters.get(display) || { count: 0, contacts: new Set<string>() };
      current.count += 1;
      current.contacts.add(contactKey);
      counters.set(display, current);
    }

    const messages = parseLogMessages(String(analysis.log_text || ""));
    const userText = messages
      .filter((m) => m.role === "USER")
      .map((m) => normalizeText(m.content))
      .join(" ");

    for (const [productName, aliases] of Object.entries(PRODUCT_ALIASES)) {
      const matched = aliases.some((alias) => userText.includes(normalizeText(alias)));
      if (!matched) continue;
      if (seenInAnalysis.has(productName)) continue;
      seenInAnalysis.add(productName);
      const current = counters.get(productName) || { count: 0, contacts: new Set<string>() };
      current.count += 1;
      current.contacts.add(contactKey);
      counters.set(productName, current);
    }
  }

  return Array.from(counters.entries())
    .map(([name, value]) => ({
      name,
      count: value.count,
      contacts: value.contacts.size,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
}

function includesAny(normalizedText: string, keywords: string[]): boolean {
  return keywords.some((keyword) => normalizedText.includes(normalizeText(keyword)));
}

export function extractOperationalAlerts(analyses: AnalysisItem[]): OperationalAlertItem[] {
  const items: OperationalAlertItem[] = [];
  let index = 0;

  for (const analysis of analyses || []) {
    const contactName = String(analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || "Contato");
    const conversationId = Number((analysis.conversation_ids || [0])[0] || 0);
    const messages = parseLogMessages(String(analysis.log_text || ""));

    for (const msg of messages) {
      if (msg.role !== "USER") continue;
      const text = normalizeText(msg.content);
      if (!text) continue;

      if (includesAny(text, CONSULTOR_KEYWORDS)) {
        index += 1;
        items.push({
          id: `alert-consultor-${index}`,
          type: "consultor",
          contactName,
          conversationId,
          excerpt: msg.content,
        });
      }
      if (includesAny(text, DISENGAGEMENT_KEYWORDS)) {
        index += 1;
        items.push({
          id: `alert-desengajamento-${index}`,
          type: "desengajamento",
          contactName,
          conversationId,
          excerpt: msg.content,
        });
      }
    }
  }

  return items;
}

export function classifyGapPhase(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return "Operacional";
  if (normalized.includes("coleta") || normalized.includes("formulario") || normalized.includes("dados")) return "Coleta de informação";
  if (normalized.includes("interesse") || normalized.includes("objetivo") || normalized.includes("produto")) return "Identificação de interesse";
  if (normalized.includes("empresa") || normalized.includes("hile")) return "Apresentação da empresa";
  if (normalized.includes("horario") || normalized.includes("agenda disponivel")) return "Apresentação de horários";
  if (normalized.includes("agendamento") || normalized.includes("reuniao") || normalized.includes("marcar")) return "Realização de agendamento";
  return "Operacional";
}
