function normalizeDiacritics(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function titleCaseWords(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeProductForMatch(value: string): string {
  return normalizeDiacritics(String(value || ""))
    .replace(/_/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function canonicalizeProductLabel(value: string): string {
  const normalized = normalizeProductForMatch(value);
  if (!normalized) return "Produto nao informado";

  if (/^whey( protein)?$/.test(normalized)) return "Whey Protein";
  if (/^creatina( monohidratada)?$/.test(normalized)) return "Creatina";
  if (/^pre treino$/.test(normalized) || /^pretreino$/.test(normalized)) return "Pre-treino";
  if (/^pos treino$/.test(normalized) || /^post treino$/.test(normalized)) return "Pos-treino";
  if (/^colageno$/.test(normalized) || /^collagen$/.test(normalized)) return "Colageno";
  if (/^suplementos fitness$/.test(normalized) || /^suplemento fitness$/.test(normalized)) {
    return "Suplementos Fitness";
  }

  return titleCaseWords(normalized);
}
