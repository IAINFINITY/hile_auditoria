import type { AnalysisItem } from "../../../../types";
import type { OperationalAlertItem, ProductDemandItem } from "../../shared/types";
import { toTitleCaseName } from "./common";
import { canonicalizeProductLabel, normalizeProductForMatch } from "@/lib/products/canonical";

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
  "Whey Protein": ["whey", "uei", "wehy", "whey protein"],
  Creatina: ["creatina", "creatine", "creatin", "creatna", "creatina monohidratada"],
  "Pre-treino": ["pre treino", "pre-treino", "pretreino", "preworkout", "pré treino", "pré-treino"],
  Colageno: ["colageno", "colágeno", "collagen"],
  "Suplementos Fitness": ["suplementos fitness", "suplemento fitness"],
};

const CONSULTOR_KEYWORDS = [
  "consultor",
  "atendente",
  "vendedor",
  "especialista",
  "supervisor",
  "gerente",
  "humano",
  "atendimento humano",
  "atendimento personalizado",
  "pessoa real",
  "pessoa",
  "quero falar com atendente",
  "quero falar com consultor",
  "quero falar com humano",
  "quero falar com pessoa",
  "passa para consultor",
  "passa para atendente",
  "me transfere",
  "me transferir",
  "transferir para consultor",
  "chamar consultor",
  "chama consultor",
  "falar com alguem",
  "falar com alguÃ©m",
  "quero atendimento humano",
];

const DISENGAGEMENT_KEYWORDS = [
  "atrasando",
  "atraso",
  "demorando",
  "demora",
  "demorou",
  "demorado",
  "lento",
  "lentidao",
  "enrolando",
  "enrolacao",
  "ruim",
  "horrivel",
  "horrÃ­vel",
  "pÃ©ssimo",
  "pessimo",
  "fraco",
  "desorganizado",
  "nao resolve",
  "nÃ£o resolve",
  "nao ajudou",
  "nÃ£o ajudou",
  "nao respondeu",
  "nÃ£o respondeu",
  "sem resposta",
  "sem retorno",
  "nao gostei",
  "nÃ£o gostei",
  "nao confio",
  "nÃ£o confio",
  "desisti",
  "cansei",
  "decepcionado",
  "decepcionada",
  "insatisfeito",
  "insatisfeita",
  "insatisfacao",
  "insatisfaÃ§Ã£o",
  "vou procurar outra",
  "vou procurar outro",
  "vou procurar concorrente",
  "vou para concorrencia",
  "vou para concorrÃªncia",
  "outra empresa",
  "outra marca",
  "toda empresa",
  "vocÃªs atrasam",
  "voces atrasam",
  "falar mal",
];

const HILE_DISSATISFACTION_KEYWORDS = [
  "hile",
  "empresa",
  "atendimento de voces",
  "atendimento de vocÃªs",
  "vocÃªs",
  "voces",
  "marca",
  "servico",
  "serviÃ§o",
];

const STRONG_DISSATISFACTION_KEYWORDS = [
  "pessimo",
  "pÃ©ssimo",
  "horrivel",
  "horrÃ­vel",
  "inadmissivel",
  "inadmissÃ­vel",
  "absurdo",
  "decepcionado",
  "decepcionada",
  "insatisfeito",
  "insatisfeita",
  "nunca mais",
  "vou procurar outra",
  "vou procurar concorrente",
  "vou para concorrencia",
  "vou para concorrÃªncia",
  "toda empresa",
  "sem resposta",
  "falar mal",
  "nao gostei",
  "nÃ£o gostei",
];

const SELF_DELAY_APOLOGY_PATTERNS = [
  "desculpa a demora",
  "desculpe a demora",
  "foi mal a demora",
  "demorei para responder",
  "demorei pra responder",
  "eu demorei",
  "atrasou aqui comigo",
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
    const withConversation = line.match(
      /^\[(.*?)\]\s*(?:\[[^\]]+\]\s*)?([^:\-\[]+?)(?:\s*\([^)]+\))?\s*[:\-]\s*(.*)$/i,
    );
    if (withConversation) {
      out.push({
        role: inferRole(withConversation[2]),
        content: String(withConversation[3] || "").trim(),
        timestamp: parseTimestamp(line),
      });
      continue;
    }

    const altMatch = line.match(/^([^:\-]+?)(?:\s*\([^)]+\))?\s*[:\-]\s*(.*)$/i);
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
  const counters = new Map<
    string,
    { occurrenceKeys: Set<string>; contacts: Set<string>; contactNames: Set<string> }
  >();
  for (const analysis of analyses || []) {
    const contactKey = String(analysis.contact_key || "").trim() || "contato";
    const contactName =
      toTitleCaseName(analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || "") ||
      contactKey;
    const conversationIds = Array.isArray(analysis.conversation_ids)
      ? analysis.conversation_ids.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
      : [];
    const occurrenceBases =
      conversationIds.length > 0
        ? conversationIds.map((conversationId) => `${contactKey}::${conversationId}`)
        : [`${contactKey}::analysis-${Number(analysis.analysis_index || 0)}`];
    const seenProductsInAnalysis = new Set<string>();
    const parsed = tryParseJson(String(analysis.analysis?.answer || ""));
    const structuredProducts = Array.isArray(parsed?.produtos_citados)
      ? (parsed?.produtos_citados as Array<Record<string, unknown>>)
      : [];

    for (const product of structuredProducts) {
      const candidate = String(product?.nome_produto || product?.termo_detectado || "").trim();
      if (!candidate) continue;
      const display = canonicalizeProductLabel(candidate);
      const productKey = normalizeProductForMatch(display);
      if (!productKey || seenProductsInAnalysis.has(productKey)) continue;
      seenProductsInAnalysis.add(productKey);
      const current = counters.get(display) || {
        occurrenceKeys: new Set<string>(),
        contacts: new Set<string>(),
        contactNames: new Set<string>(),
      };
      for (const occurrenceBase of occurrenceBases) {
        current.occurrenceKeys.add(occurrenceBase);
      }
      current.contacts.add(contactKey);
      current.contactNames.add(contactName);
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
      const display = canonicalizeProductLabel(productName);
      const productKey = normalizeProductForMatch(display);
      if (!productKey || seenProductsInAnalysis.has(productKey)) continue;
      seenProductsInAnalysis.add(productKey);
      const current = counters.get(display) || {
        occurrenceKeys: new Set<string>(),
        contacts: new Set<string>(),
        contactNames: new Set<string>(),
      };
      for (const occurrenceBase of occurrenceBases) {
        current.occurrenceKeys.add(occurrenceBase);
      }
      current.contacts.add(contactKey);
      current.contactNames.add(contactName);
      counters.set(display, current);
    }
  }

  return Array.from(counters.entries())
    .map(([name, value]) => ({
      name,
      count: value.occurrenceKeys.size,
      contacts: value.contacts.size,
      contactNames: Array.from(value.contactNames)
        .map((name) => toTitleCaseName(name))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
}

function includesAny(normalizedText: string, keywords: string[]): boolean {
  return keywords.some((keyword) => normalizedText.includes(normalizeText(keyword)));
}

function classifyDissatisfactionCategory(text: string): "insatisfacao_hile" | "insatisfacao_atendimento" {
  if (includesAny(text, HILE_DISSATISFACTION_KEYWORDS)) return "insatisfacao_hile";
  return "insatisfacao_atendimento";
}

function classifyDissatisfactionSeverity(text: string): "critical" | "high" {
  if (includesAny(text, STRONG_DISSATISFACTION_KEYWORDS)) return "critical";
  return "high";
}

function looksLikeSelfDelayApology(text: string): boolean {
  return includesAny(text, SELF_DELAY_APOLOGY_PATTERNS);
}

function parseTimestampFromReference(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const bracketIso = raw.match(/\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/);
  if (bracketIso?.[1]) {
    const date = new Date(bracketIso[1]);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function pushAlertIfUnique(target: OperationalAlertItem[], next: OperationalAlertItem) {
  const fingerprint = `${next.type}|${next.conversationId}|${normalizeText(next.excerpt)}|${next.occurredAt || ""}`;
  const alreadyExists = target.some((item) => {
    const current = `${item.type}|${item.conversationId}|${normalizeText(item.excerpt)}|${item.occurredAt || ""}`;
    return current === fingerprint;
  });
  if (!alreadyExists) target.push(next);
}

export function extractOperationalAlerts(analyses: AnalysisItem[]): OperationalAlertItem[] {
  const items: OperationalAlertItem[] = [];
  let index = 0;

  for (const analysis of analyses || []) {
    const contactName = toTitleCaseName(
      analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || "Contato",
    );
    const conversationId = Number((analysis.conversation_ids || [0])[0] || 0);
    const messages = parseLogMessages(String(analysis.log_text || ""));
    const parsed = tryParseJson(String(analysis.analysis?.answer || ""));

    for (const msg of messages) {
      if (msg.role !== "USER") continue;
      const text = normalizeText(msg.content);
      if (!text) continue;

      if (includesAny(text, CONSULTOR_KEYWORDS)) {
        index += 1;
        pushAlertIfUnique(items, {
          id: `alert-consultor-${index}`,
          type: "consultor",
          category: "pedido_consultor",
          severity: "medium",
          contactName,
          conversationId,
          excerpt: msg.content,
          occurredAt: msg.timestamp ? msg.timestamp.toISOString() : null,
        });
      }
      if (includesAny(text, DISENGAGEMENT_KEYWORDS)) {
        // Heuristic fallback: only keep very explicit complaints. General delay phrases
        // should come from structured AI signals to avoid false positives.
        if (looksLikeSelfDelayApology(text)) continue;
        if (!includesAny(text, STRONG_DISSATISFACTION_KEYWORDS)) continue;
        const category = classifyDissatisfactionCategory(text);
        const severity = classifyDissatisfactionSeverity(text);
        index += 1;
        pushAlertIfUnique(items, {
          id: `alert-desengajamento-${index}`,
          type: "desengajamento",
          category,
          severity,
          contactName,
          conversationId,
          excerpt: msg.content,
          occurredAt: msg.timestamp ? msg.timestamp.toISOString() : null,
        });
      }
    }

    const structuredSignalsRaw = Array.isArray(parsed?.sinais_atencao)
      ? parsed.sinais_atencao
      : Array.isArray(parsed?.new_attention_signals)
        ? parsed.new_attention_signals
        : [];
    const structuredSignals = structuredSignalsRaw.map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null)).filter(Boolean) as Record<string, unknown>[];

    for (const signal of structuredSignals) {
      const signalType = normalizeText(String(signal.tipo || signal.type || ""));
      const description = String(signal.descricao || signal.description || "").trim();
      const reference = String(signal.mensagem_referencia || signal.message_reference || "").trim();
      const excerpt = reference || description;
      if (!excerpt) continue;
      const occurredAt = parseTimestampFromReference(signal.mensagem_referencia || signal.message_reference);

      if (signalType.includes("consultor")) {
        index += 1;
        pushAlertIfUnique(items, {
          id: `alert-consultor-structured-${index}`,
          type: "consultor",
          category: "pedido_consultor",
          severity: "medium",
          contactName,
          conversationId,
          excerpt,
          occurredAt,
        });
        continue;
      }

      if (signalType.includes("desengaj")) {
        const normalizedText = normalizeText(`${description} ${reference}`);
        const category = classifyDissatisfactionCategory(normalizedText);
        const severity = classifyDissatisfactionSeverity(normalizedText);
        index += 1;
        pushAlertIfUnique(items, {
          id: `alert-desengajamento-structured-${index}`,
          type: "desengajamento",
          category,
          severity,
          contactName,
          conversationId,
          excerpt,
          occurredAt,
        });
      }
    }
  }

  return items;
}

export function classifyGapPhase(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) return "Operacional";
  if (
    normalized.includes("match_categorizacao_perfil") ||
    normalized.includes("match") ||
    normalized.includes("categorizacao") ||
    normalized.includes("categorizacao de perfil") ||
    normalized.includes("perfil do cliente") ||
    normalized.includes("compatibilidade")
  ) {
    return "Match/CategorizaÃ§Ã£o de perfil";
  }
  if (normalized.includes("coleta") || normalized.includes("formulario") || normalized.includes("dados")) return "Coleta de informaÃ§Ã£o";
  if (normalized.includes("interesse") || normalized.includes("objetivo") || normalized.includes("produto")) return "IdentificaÃ§Ã£o de interesse";
  if (normalized.includes("empresa") || normalized.includes("hile")) return "ApresentaÃ§Ã£o da empresa";
  if (normalized.includes("horario") || normalized.includes("agenda disponivel")) return "ApresentaÃ§Ã£o de horÃ¡rios";
  if (normalized.includes("agendamento") || normalized.includes("reuniao") || normalized.includes("marcar")) return "RealizaÃ§Ã£o de agendamento";
  return "Operacional";
}



