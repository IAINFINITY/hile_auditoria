import type { ReportPayload, Severity } from "../../../../types";
import {
  asRecord,
  inferSeverityFromValue,
  normalizeTextForMatch,
  parseJsonObject,
  toStringList,
  type ReportSeverityFilter,
} from "./common";

export function buildStructuredReportMarkdown(
  report: ReportPayload | null,
  selectedContact: string | null,
  severityFilter: ReportSeverityFilter,
): string {
  if (!report?.raw_analysis?.analyses?.length) return "";
  const analyses = report.raw_analysis.analyses;
  const filteredSections: string[] = [];
  const contactNeedle = normalizeTextForMatch(selectedContact);

  analyses.forEach((analysis, index) => {
    const parsed = parseJsonObject(analysis.analysis?.answer);
    const contactName = String(
      analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key || `Contato ${index + 1}`,
    );
    const conversationIds = Array.isArray(analysis.conversation_ids)
      ? analysis.conversation_ids.map((id) => Number(id)).filter((id) => id > 0)
      : [];
    const resumo = String(parsed.resumo || "Sem resumo estruturado.");
    const melhorias = toStringList(parsed.pontos_melhoria);
    const proximosPassos = toStringList(parsed.proximos_passos);
    const isCriticalRisk = Boolean(parsed.risco_critico);
    const analysisSeverity = inferSeverityFromValue(
      parsed.severidade || parsed.severity || parsed.nivel_risco || parsed.risco,
      isCriticalRisk ? "critical" : "info",
    );

    const gaps = Array.isArray(parsed.gaps_operacionais) ? parsed.gaps_operacionais : [];
    const gapSeverities = gaps
      .map((gap) => asRecord(gap))
      .map((gap) => inferSeverityFromValue(gap.severidade || gap.severity || gap.nivel || gap.prioridade, analysisSeverity));

    const shouldIncludeBySeverity =
      severityFilter === "all" ||
      analysisSeverity === severityFilter ||
      gapSeverities.includes(severityFilter as Severity);

    const shouldIncludeByContact =
      !contactNeedle || normalizeTextForMatch(contactName).includes(contactNeedle);

    if (!shouldIncludeBySeverity || !shouldIncludeByContact) return;

    const gapLines = gaps
      .map((gap) => asRecord(gap))
      .map((gap, gapIndex) => {
        const nome = String(gap.nome_gap || gap.nome || gap.titulo || gap.title || "Gap operacional");
        const severidade = inferSeverityFromValue(
          gap.severidade || gap.severity || gap.nivel || gap.prioridade,
          analysisSeverity,
        );
        const descricao = String(gap.descricao || gap.description || gap.detalhe || gap.contexto || "").trim();
        const reference = String(gap.mensagem_referencia || gap.message_reference || gap.referencia_mensagem || "").trim();
        const ptSeverity =
          severidade === "critical"
            ? "Crítico"
            : severidade === "high"
              ? "Alto"
              : severidade === "medium"
                ? "Médio"
                : severidade === "low"
                  ? "Baixo"
                  : "Informativo";
        return `- Gap ${gapIndex + 1}: ${nome} (${ptSeverity})${descricao ? ` - ${descricao}` : ""}${reference ? ` | Ref: ${reference}` : ""}`;
      });

    const lines: string[] = [
      `### ${index + 1}. ${contactName}`,
      `- Contact key: \`${analysis.contact_key}\``,
      `- Conversas: ${conversationIds.length > 0 ? conversationIds.join(", ") : "não informado"}`,
      `- Severidade principal: ${
        analysisSeverity === "critical"
          ? "Crítico"
          : analysisSeverity === "high"
            ? "Alto"
            : analysisSeverity === "medium"
              ? "Médio"
              : analysisSeverity === "low"
                ? "Baixo"
                : "Informativo"
      }`,
      `- Risco crítico: ${isCriticalRisk ? "Sim" : "Não"}`,
      `- Resumo: ${resumo}`,
      `- Pontos de melhoria: ${melhorias.length > 0 ? melhorias.join(" | ") : "Nenhum ponto informado."}`,
      `- Próximos passos: ${proximosPassos.length > 0 ? proximosPassos.join(" | ") : "Nenhum próximo passo informado."}`,
      `- Gaps operacionais identificados: ${gapLines.length}`,
      ...gapLines,
    ];

    filteredSections.push(lines.join("\n"));
  });

  if (filteredSections.length === 0) {
    const contactPart = selectedContact ? `contato "${selectedContact}"` : "contato";
    const severityPart = severityFilter !== "all" ? ` e severidade "${severityFilter}"` : "";
    return `Nenhum trecho estruturado foi encontrado para ${contactPart}${severityPart}.`;
  }

  const header = [
    "# Relatório Diário - Auditoria de Atendimento",
    "",
    `- Data: ${report.date}`,
    `- Conta: ${report.account?.name || "N/A"} (id ${report.account?.id || "N/A"})`,
    `- Canal: ${report.inbox?.name || "N/A"} (id ${report.inbox?.id || "N/A"})`,
    "",
    "## Detalhamento por Contato",
    "",
  ];

  return [...header, filteredSections.join("\n\n")].join("\n");
}
