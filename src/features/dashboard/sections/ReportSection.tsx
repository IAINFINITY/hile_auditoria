import { useEffect, useMemo, useState } from "react";
import type { Severity } from "../../../types";
import type { ReportHistoryItem, ReportPayload } from "../../../types";
import { PaginationControls } from "./report/PaginationControls";
import {
  REPORT_SEVERITY_OPTIONS,
  extractStateLabels,
  includesAnyLabel,
  labelClass,
  paginate,
  parseLabelsFromLogText,
  parsePossibleJsonObject,
  toSeverity,
  toneColor,
  type ContactContextItem,
  type ReportItem,
  type SeverityFilter,
} from "./report/utils";

interface ReportSectionProps {
  criticalGapInsights: Array<{
    id: string;
    severity: Severity;
    summary: string;
    contact_name: string;
    labels?: string[];
  }>;
  report: ReportPayload | null;
  reportHistory: ReportHistoryItem[];
  selectedReportContact: string | null;
  onSelectReportContact: (value: string | null) => void;
  reportSeverityFilter: SeverityFilter;
  onChangeReportSeverityFilter: (value: SeverityFilter) => void;
  selectedDate: string;
}

export function ReportSection({
  criticalGapInsights,
  report,
  reportHistory,
  selectedReportContact,
  onSelectReportContact,
  reportSeverityFilter,
  onChangeReportSeverityFilter,
  selectedDate,
}: ReportSectionProps) {
  const hasReportData = Boolean(report?.raw_analysis?.analyses?.length) || criticalGapInsights.length > 0;
  const [contextPage, setContextPage] = useState(1);
  const [gapsPage, setGapsPage] = useState(1);
  const [localContactFilter, setLocalContactFilter] = useState<string>("");
  const [situacaoFilter, setSituacaoFilter] = useState<string>("all");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [filterPulse, setFilterPulse] = useState(0);
  const perPage = 5;

  useEffect(() => {
    setLocalContactFilter(selectedReportContact || "");
  }, [selectedReportContact]);

  const historyForSelectedDate = useMemo(() => {
    const target = String(selectedDate || "").trim();
    if (!target) return [] as ReportHistoryItem[];
    return reportHistory.filter((item) => String(item.date_ref || "").trim() === target);
  }, [reportHistory, selectedDate]);

  const generatedAtLabel = useMemo(() => {
    const latest = historyForSelectedDate[0];
    const dateIso = latest?.finished_at || latest?.started_at || "";
    if (!dateIso) return "--";
    return new Date(dateIso).toLocaleString("pt-BR");
  }, [historyForSelectedDate]);

  const contextOverview = useMemo(() => {
    const analyses = report?.raw_analysis?.analyses || [];
    if (analyses.length === 0) return [] as string[];

    const tags = new Map<string, number>();
    let waitingOnAgentCount = 0;

    for (const analysis of analyses) {
      const state = analysis.conversation_operational?.[0]?.state;
      if (state?.waiting_on_agent) waitingOnAgentCount += 1;
      for (const tag of parseLabelsFromLogText(String(analysis.log_text || ""))) {
        const key = tag.toLowerCase();
        tags.set(key, (tags.get(key) || 0) + 1);
      }
    }

    const topTags = [...tags.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag, count]) => `${tag} (${count})`);

    return [
      `Análises processadas no dia: ${analyses.length}.`,
      `Conversas aguardando resposta da IA/atendente: ${waitingOnAgentCount}.`,
      topTags.length > 0 ? `Etiquetas mais frequentes: ${topTags.join(" • ")}.` : "Sem etiquetas relevantes no período.",
    ];
  }, [report]);

  const contactContextItems = useMemo<ContactContextItem[]>(() => {
    const analyses = report?.raw_analysis?.analyses || [];

    return analyses
      .slice()
      .sort((a, b) => Number(a.analysis_index || 0) - Number(b.analysis_index || 0))
      .map((analysis) => {
        const parsed = parsePossibleJsonObject(String(analysis.analysis?.answer || ""));
        const toList = (value: unknown): string[] =>
          Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];

        const contactName = analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key;
        const resumo = String(parsed.resumo || "Sem resumo estruturado.");
        const melhorias = toList(parsed.pontos_melhoria);
        const proximos = toList(parsed.proximos_passos);
        const riscoCritico = Boolean(parsed.risco_critico);
        const fallbackSeverity: Severity = riscoCritico ? "critical" : "info";
        const severity = toSeverity(
          parsed.severidade || parsed.severity || parsed.nivel_risco || parsed.risco,
          fallbackSeverity,
        );

        const state = analysis.conversation_operational?.[0]?.state;
        const situacao =
          state?.finalization_status === "finalizada"
            ? state.finalization_actor
              ? `Finalizada por ${state.finalization_actor}`
              : "Finalizada"
            : state?.waiting_on_agent
              ? "Aguardando resposta da IA/atendente"
              : state?.waiting_on_customer
                ? "Aguardando retorno do cliente"
                : "Em andamento";

        const evidenceLines = String(analysis.log_text || "")
          .split("\n")
          .filter((line) => /\] (USER|AGENT) /i.test(line))
          .slice(-2);
        const evidencia = evidenceLines.length > 0 ? evidenceLines.join(" | ") : "Sem trecho de evidência disponível.";
        const labels = extractStateLabels(state).length > 0 ? extractStateLabels(state) : parseLabelsFromLogText(String(analysis.log_text || ""));

        return {
          key: `${analysis.contact_key}-${analysis.analysis_index || 0}`,
          contactName,
          situacao,
          contexto: resumo,
          evidencia,
          risco: riscoCritico ? "Crítico" : "Não crítico",
          acao: proximos[0] || melhorias[0] || "Sem ação recomendada no retorno da IA.",
          labels,
          severity,
        };
      });
  }, [report]);

  const availableContacts = useMemo(() => {
    const unique = new Set<string>();
    for (const item of contactContextItems) unique.add(item.contactName);
    return Array.from(unique).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [contactContextItems]);

  const availableSituacoes = useMemo(() => {
    const unique = new Set<string>();
    for (const item of contactContextItems) unique.add(item.situacao);
    return Array.from(unique).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [contactContextItems]);

  const reportGaps = useMemo<ReportItem[]>(() => {
    return criticalGapInsights.map((item) => ({
      key: `gap-${item.id}`,
      title: item.severity === "critical" ? "Gap Crítico" : "Gap Alto",
      desc: `${item.contact_name}: ${item.summary}`,
      severity: item.severity,
      contactName: item.contact_name,
      labels: Array.isArray(item.labels) ? item.labels : [],
    }));
  }, [criticalGapInsights]);

  const availableLabels = useMemo(() => {
    const all = new Set<string>();
    for (const item of contactContextItems) {
      for (const label of item.labels) all.add(label);
    }
    for (const item of reportGaps) {
      for (const label of item.labels) all.add(label);
    }
    return Array.from(all).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [contactContextItems, reportGaps]);

  const displayLabels = useMemo(() => {
    return availableLabels;
  }, [availableLabels]);

  const normalizedContactFilter = localContactFilter.trim().toLowerCase();
  const normalizedSituacaoFilter = situacaoFilter.trim().toLowerCase();

  const filteredContactContextItems = useMemo<ContactContextItem[]>(() => {
    return contactContextItems.filter((item) => {
      const byUser = !normalizedContactFilter || item.contactName.toLowerCase().includes(normalizedContactFilter);
      const bySituacao = normalizedSituacaoFilter === "all" || item.situacao.toLowerCase() === normalizedSituacaoFilter;
      const byLabel = includesAnyLabel(item.labels, selectedLabels);
      const bySeverity = reportSeverityFilter === "all" || item.severity === reportSeverityFilter;
      return byUser && bySituacao && byLabel && bySeverity;
    });
  }, [contactContextItems, normalizedContactFilter, normalizedSituacaoFilter, selectedLabels, reportSeverityFilter]);

  const filteredGaps = useMemo<ReportItem[]>(() => {
    return reportGaps.filter((item) => {
      const byUser = !normalizedContactFilter || item.contactName.toLowerCase().includes(normalizedContactFilter);
      const byLabel = includesAnyLabel(item.labels, selectedLabels);
      const bySeverity = reportSeverityFilter === "all" || item.severity === reportSeverityFilter;
      return byUser && byLabel && bySeverity;
    });
  }, [reportGaps, normalizedContactFilter, selectedLabels, reportSeverityFilter]);

  const contextChunk = paginate(filteredContactContextItems, contextPage, perPage);
  const gapsChunk = paginate(filteredGaps, gapsPage, perPage);

  function keepScroll(update: () => void) {
    const y = typeof window !== "undefined" ? window.scrollY : 0;
    update();
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => window.scrollTo({ top: y }));
    }
  }

  function toggleLabel(label: string) {
    const low = label.toLowerCase();
    setSelectedLabels((current) => (current.includes(low) ? current.filter((item) => item !== low) : [...current, low]));
    setFilterPulse((value) => value + 1);
    setContextPage(1);
    setGapsPage(1);
  }

  return (
    <div className="section reveal" id="relatorio">
      <div className="section-inner">
        <div className="section-header">
          <span className="section-num">05</span>
          <div className="section-title">
            <h2>Relatório de Auditoria</h2>
            <p>Resumo executivo no padrão de leitura rápida</p>
          </div>
        </div>

        <div className={`metrics-block ${hasReportData ? "" : "data-dim"}`}>
          <div className="metrics-block-header">
            <span>Relatório consolidado</span>
            <span>Gerado em: {generatedAtLabel}</span>
          </div>

          <div className="metrics-block-body">
            <div className="report-section-sep">
              <h3 className="report-section-title">Contexto do Dia</h3>
              {contextOverview.length === 0 ? (
                <p className="empty-state">Execute o overview para consolidar contexto do dia.</p>
              ) : (
                contextOverview.map((line, index) => (
                  <article className="report-card" key={`ctx-${index}`}>
                    <span className="report-card-dot" style={{ background: "var(--azul)" }} />
                    <div className="report-card-content">
                      <p>{line}</p>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="report-section-sep">
              <h3 className="report-section-title">Filtros do Relatório</h3>
                            <div className="report-filters-shell" key={filterPulse}>
                <div className="report-filters-grid">
                  <div className="report-filter-field">
                    <label htmlFor="report-situacao-filter">Situação</label>
                    <select
                      id="report-situacao-filter"
                      value={situacaoFilter}
                      onChange={(event) => {
                        setSituacaoFilter(event.target.value);
                        setFilterPulse((value) => value + 1);
                        setContextPage(1);
                      }}
                    >
                      <option value="all">Todas</option>
                      {availableSituacoes.map((situacao) => (
                        <option value={situacao} key={situacao}>
                          {situacao}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="report-filter-field">
                    <label htmlFor="report-severity-filter">Severidade</label>
                    <select
                      id="report-severity-filter"
                      value={reportSeverityFilter}
                      onChange={(event) => {
                        onChangeReportSeverityFilter(event.target.value as SeverityFilter);
                        setFilterPulse((value) => value + 1);
                        setContextPage(1);
                        setGapsPage(1);
                      }}
                    >
                      {REPORT_SEVERITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="report-filter-field">
                    <label htmlFor="report-user-filter">Usuário</label>
                    <select
                      id="report-user-filter"
                      value={localContactFilter}
                      onChange={(event) => {
                        const next = event.target.value;
                        setLocalContactFilter(next);
                        onSelectReportContact(next.trim() ? next : null);
                        setFilterPulse((value) => value + 1);
                        setContextPage(1);
                        setGapsPage(1);
                      }}
                    >
                      <option value="">Todos</option>
                      {availableContacts.map((name) => (
                        <option value={name} key={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="report-filter-labels">
                  <span className="report-filter-label-title">Etiquetas</span>
                  <div className="gap-label-row">
                    {displayLabels.map((label) => {
                      const selected = selectedLabels.includes(label.toLowerCase());
                      return (
                        <button
                          key={label}
                          type="button"
                          className={`${labelClass(label)} ${selected ? "tag-selected" : ""}`}
                          onClick={() => toggleLabel(label)}
                        >
                          {label}
                        </button>
                      );
                    })}

                    <button
                      className="tag tag-clear"
                      type="button"
                      onClick={() => {
                        setLocalContactFilter("");
                        setSituacaoFilter("all");
                        setSelectedLabels([]);
                        onSelectReportContact(null);
                        onChangeReportSeverityFilter("all");
                        setFilterPulse((value) => value + 1);
                        setContextPage(1);
                        setGapsPage(1);
                      }}
                    >
                      Limpar
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="report-section-sep">
              <h3 className="report-section-title">Contexto por Usuário</h3>
              {contextChunk.rows.length === 0 ? (
                <p className="empty-state">Sem dados por usuário no momento.</p>
              ) : (
                <>
                  <div className="report-list-animated" key={`context-${filterPulse}-${contextChunk.safePage}`}>
                    {contextChunk.rows.map((item) => (
                      <article className="report-card" key={item.key}>
                        <span className="report-card-dot" style={{ background: toneColor(item.severity) }} />
                        <div className="report-card-content">
                          <h4>{item.contactName}</h4>
                          <p>
                            <strong>Situação:</strong> {item.situacao}
                          </p>
                          <p>
                            <strong>Severidade:</strong>{" "}
                            {item.severity === "critical"
                              ? "Crítico"
                              : item.severity === "high"
                                ? "Alto"
                                : item.severity === "medium"
                                  ? "Médio"
                                  : item.severity === "low"
                                    ? "Baixo"
                                    : "Informativo"}
                          </p>
                          <p>
                            <strong>Contexto:</strong> {item.contexto}
                          </p>
                          <p>
                            <strong>Evidência:</strong> {item.evidencia}
                          </p>
                          <p>
                            <strong>Risco:</strong> {item.risco}
                          </p>
                          <p>
                            <strong>Ação recomendada:</strong> {item.acao}
                          </p>
                          <div className="gap-label-row">
                            {item.labels.length > 0 ? (
                              item.labels.map((tag) => (
                                <span className={labelClass(tag)} key={`${item.key}-${tag}`}>
                                  {tag}
                                </span>
                              ))
                            ) : (
                              <span className="tag">sem etiqueta</span>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  {filteredContactContextItems.length > perPage ? (
                    <PaginationControls
                      total={filteredContactContextItems.length}
                      safePage={contextChunk.safePage}
                      pages={contextChunk.pages}
                      onPrev={() => keepScroll(() => setContextPage(Math.max(1, contextChunk.safePage - 1)))}
                      onNext={() => keepScroll(() => setContextPage(Math.min(contextChunk.pages, contextChunk.safePage + 1)))}
                    />
                  ) : null}
                </>
              )}
            </div>

            <div className="report-section-sep">
              <h3 className="report-section-title">Gaps Operacionais</h3>
              {gapsChunk.rows.length === 0 ? (
                <p className="empty-state">Nenhum gap operacional para exibir.</p>
              ) : (
                <>
                  <div className="report-list-animated" key={`gaps-${filterPulse}-${gapsChunk.safePage}`}>
                    {gapsChunk.rows.map((item) => (
                      <article className="report-card" key={item.key}>
                        <span className="report-card-dot" style={{ background: toneColor(item.severity) }} />
                        <div className="report-card-content">
                          <h4>{item.title}</h4>
                          <p>{item.desc}</p>
                          <div className="gap-label-row">
                            {item.labels.length > 0 ? (
                              item.labels.map((tag) => (
                                <span className={labelClass(tag)} key={`${item.key}-${tag}`}>
                                  {tag}
                                </span>
                              ))
                            ) : (
                              <span className="tag">sem etiqueta</span>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  {filteredGaps.length > perPage ? (
                    <PaginationControls
                      total={filteredGaps.length}
                      safePage={gapsChunk.safePage}
                      pages={gapsChunk.pages}
                      onPrev={() => keepScroll(() => setGapsPage(Math.max(1, gapsChunk.safePage - 1)))}
                      onNext={() => keepScroll(() => setGapsPage(Math.min(gapsChunk.pages, gapsChunk.safePage + 1)))}
                    />
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}







