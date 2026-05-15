import type { InsightSeverity } from "@prisma/client";
import type { ReportPayload } from "@/types";
import { toTitleCaseName } from "./nameFormat";

type AnalysisItem = NonNullable<ReportPayload["raw_analysis"]["analyses"]>[number];

export interface ClientRecordDraft {
  phonePk: string;
  contactName: string;
  companyName: string | null;
  cnpj: string | null;
  gaps: string[];
  attentions: string[];
  labels: string[];
  conversationIds: number[];
  chatLinks: string[];
  openedAt: Date | null;
  closedAt: Date | null;
  status: string;
  severity: InsightSeverity;
}

interface MutableClientRecord {
  phonePk: string;
  contactName: string;
  companyName: string | null;
  cnpj: string | null;
  gaps: Set<string>;
  attentions: Set<string>;
  labels: Set<string>;
  conversationIds: Set<number>;
  chatLinks: Set<string>;
  openedAt: Date | null;
  closedAt: Date | null;
  status: string;
  severity: InsightSeverity;
}

const severityOrder: Record<InsightSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function normalizeDigits(value: unknown): string {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractPhoneFromText(text: string): string {
  const matches = text.match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}-?\d{4}/g);
  if (!matches?.length) return "";
  const best = matches
    .map((item) => normalizeDigits(item))
    .filter((item) => item.length >= 10)
    .sort((a, b) => b.length - a.length)[0];
  return best || "";
}

function extractCnpj(text: string): string {
  const match = text.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
  return match?.[0] || "";
}

function extractCompanyName(text: string): string {
  const patterns = [
    /"empresa"\s*:\s*"([^"\n\r]+)"/i,
    /"nome_empresa"\s*:\s*"([^"\n\r]+)"/i,
    /"razao_social"\s*:\s*"([^"\n\r]+)"/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = String(match?.[1] || "").trim();
    if (value) return value;
  }

  return "";
}

function extractLogDates(logText: string): Date[] {
  const found = [...String(logText || "").matchAll(/\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/g)]
    .map((match) => String(match[1] || "").trim())
    .filter(Boolean)
    .map((iso) => new Date(iso))
    .filter((date) => !Number.isNaN(date.getTime()));
  return found;
}

function parseLabelsFromLogText(logText: string): string[] {
  const marker = /Etiquetas?:\s*(.+)$/gim;
  const labels: string[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = marker.exec(logText))) {
    const chunk = String(match[1] || "");
    for (const part of chunk.split(/[|,]/g)) {
      const label = String(part || "").trim();
      if (label) labels.push(label);
    }
  }

  return labels;
}

function normalizeSeverity(value: unknown): InsightSeverity {
  const text = normalizeText(value);
  if (text.includes("crit")) return "critical";
  if (text.includes("alt") || text === "high") return "high";
  if (text.includes("med")) return "medium";
  if (text.includes("baix")) return "low";
  return "info";
}

function parsePossibleJsonObject(raw: string): Record<string, unknown> {
  const clean = String(raw || "").trim();
  if (!clean) return {};
  try {
    return JSON.parse(clean);
  } catch {
    const fenced = clean.match(/```json\s*([\s\S]*?)\s*```/i);
    if (!fenced) return {};
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return {};
    }
  }
}

function mapStatus(record: MutableClientRecord): string {
  if (record.status === "resolvido") return "resolvido";
  if (record.gaps.size > 0 || record.severity === "critical" || record.severity === "high") return "atencao";
  return "aberto";
}

function createDraft(phonePk: string, contactName: string): MutableClientRecord {
  return {
    phonePk,
    contactName,
    companyName: null,
    cnpj: null,
    gaps: new Set<string>(),
    attentions: new Set<string>(),
    labels: new Set<string>(),
    conversationIds: new Set<number>(),
    chatLinks: new Set<string>(),
    openedAt: null,
    closedAt: null,
    status: "aberto",
    severity: "info",
  };
}

export function buildClientRecordsFromAnalyses(analyses: AnalysisItem[]): ClientRecordDraft[] {
  const map = new Map<string, MutableClientRecord>();

  for (const analysis of analyses || []) {
    const logText = String(analysis.log_text || "");
    const parsed = parsePossibleJsonObject(String(analysis.analysis?.answer || ""));
    const fallbackPhone = normalizeDigits(analysis.contact?.identifier);
    const phonePk = fallbackPhone || extractPhoneFromText(logText) || `sem-telefone-${analysis.contact_key}`;
    const contactName = toTitleCaseName(
      String(analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || "Contato sem nome").trim(),
    );
    if (!map.has(phonePk)) {
      map.set(phonePk, createDraft(phonePk, contactName));
    }

    const record = map.get(phonePk)!;
    const nextContactName = toTitleCaseName(String(analysis.contact?.name || "").trim());
    if (nextContactName) record.contactName = nextContactName;

    const companyName = extractCompanyName(logText);
    if (companyName && !record.companyName) record.companyName = companyName;

    const cnpj = extractCnpj(logText);
    if (cnpj && !record.cnpj) record.cnpj = cnpj;

    const labelsFromState = (analysis.conversation_operational || [])
      .flatMap((entry) => entry?.state?.labels || [])
      .map((label) => String(label || "").trim())
      .filter(Boolean);
    const labelsFromLog = parseLabelsFromLogText(logText);
    for (const label of [...labelsFromState, ...labelsFromLog]) {
      record.labels.add(label);
    }

    const dates = extractLogDates(logText);
    if (dates.length > 0) {
      const minDate = dates.reduce((min, value) => (value < min ? value : min), dates[0]);
      const maxDate = dates.reduce((max, value) => (value > max ? value : max), dates[0]);
      if (!record.openedAt || minDate < record.openedAt) record.openedAt = minDate;
      if (!record.closedAt || maxDate > record.closedAt) record.closedAt = maxDate;
    }

    const gapsRaw = Array.isArray(parsed.gaps_operacionais) ? parsed.gaps_operacionais : [];
    for (const gapItem of gapsRaw) {
      if (typeof gapItem === "string") {
        const text = gapItem.trim();
        if (text) record.gaps.add(text);
        continue;
      }
      const gapObj = gapItem && typeof gapItem === "object" ? (gapItem as Record<string, unknown>) : {};
      const text = String(gapObj.descricao || gapObj.description || gapObj.nome_gap || gapObj.gap || "").trim();
      if (text) record.gaps.add(text);
    }

    const improvementsRaw = Array.isArray(parsed.pontos_melhoria) ? parsed.pontos_melhoria : [];
    for (const item of improvementsRaw) {
      const text = String(item || "").trim();
      if (text) record.attentions.add(text);
    }

    for (const rawConversationId of analysis.conversation_ids || []) {
      const conversationId = Number(rawConversationId || 0);
      if (conversationId > 0) record.conversationIds.add(conversationId);
    }

    const linksFromAnalysis = (analysis as unknown as { chatwoot_links?: unknown[] }).chatwoot_links;
    if (Array.isArray(linksFromAnalysis)) {
      for (const link of linksFromAnalysis) {
        const text = String(link || "").trim();
        if (text) record.chatLinks.add(text);
      }
    }

    const isFinalized = (analysis.conversation_operational || []).some(
      (entry) => entry?.state?.finalization_status === "finalizada",
    );
    if (isFinalized) {
      record.status = "resolvido";
    }

    const severity = normalizeSeverity(parsed.severidade || parsed.severity || parsed.nivel_risco || parsed.risco);
    if (severityOrder[severity] > severityOrder[record.severity]) {
      record.severity = severity;
    }
    record.status = mapStatus(record);
  }

  return Array.from(map.values()).map((record) => ({
    phonePk: record.phonePk,
    contactName: record.contactName,
    companyName: record.companyName,
    cnpj: record.cnpj,
    gaps: Array.from(record.gaps),
    attentions: Array.from(record.attentions),
    labels: Array.from(record.labels),
    conversationIds: Array.from(record.conversationIds).sort((a, b) => a - b),
    chatLinks: Array.from(record.chatLinks),
    openedAt: record.openedAt,
    closedAt: record.closedAt,
    status: record.status,
    severity: record.severity,
  }));
}
