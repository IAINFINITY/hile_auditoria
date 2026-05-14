import { useEffect, useMemo, useState } from "react";
import type { Severity } from "../../../types";
import type { ReportHistoryItem, ReportPayload } from "../../../types";

type SeverityFilter = "all" | Severity;

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
}

interface ReportItem {
  key: string;
  title: string;
  desc: string;
  severity: Severity;
  contactName: string;
  labels: string[];
}

interface ContactContextItem {
  key: string;
  contactName: string;
  situacao: string;
  contexto: string;
  evidencia: string;
  risco: string;
  acao: string;
  labels: string[];
  severity: Severity;
}

const REPORT_SEVERITY_OPTIONS: Array<{ value: SeverityFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "critical", label: "Crítico" },
  { value: "high", label: "Alto" },
  { value: "medium", label: "Médio" },
  { value: "low", label: "Baixo" },
  { value: "info", label: "Informativo" },
];

const DEFAULT_LABEL_HINTS = [
  "abandono",
  "atraso_sla",
  "falha_processo",
  "lead_agendado",
  "pausar_ia",
  "transferencia",
];

function toneColor(severity: Severity): string {
  if (severity === "critical") return "var(--critical)";
  if (severity === "high") return "var(--high)";
  if (severity === "medium") return "var(--medium)";
  if (severity === "low") return "var(--low)";
  return "var(--info)";
}

function labelClass(tag: string): string {
  const value = String(tag || "").toLowerCase();
  if (value.includes("lead_agendado")) return "tag tag-ok";
  if (value.includes("pausar_ia")) return "tag tag-pause";
  if (value.includes("quente")) return "tag tag-warm";
  return "tag";
}

function paginate<T>(items: T[], page: number, perPage: number): { rows: T[]; pages: number; safePage: number } {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * perPage;
  return { rows: items.slice(start, start + perPage), pages, safePage };
}

function parsePossibleJsonObject(text: string): Record<string, unknown> {
  const raw = String(text || "").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i);
    if (!fenced?.[1]) return {};
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return {};
    }
  }
}

function parseLabelsFromLogText(logText: string): string[] {
  const tags = new Set<string>();
  for (const line of String(logText || "").split("\n")) {
    const matches = line.match(/\[etiquetas:\s*([^\]]+)\]/i);
    if (!matches?.[1]) continue;
    for (const value of matches[1].split(",")) {
      const clean = value.trim();
      if (clean) tags.add(clean);
    }
  }
  return Array.from(tags);
}

function extractStateLabels(state: unknown): string[] {
  const record = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  if (!Array.isArray(record.labels)) return [];
  return record.labels.map((item) => String(item)).filter(Boolean);
}

function includesAnyLabel(source: string[], selected: string[]): boolean {
  if (selected.length === 0) return true;
  const sourceSet = new Set(source.map((item) => item.toLowerCase()));
  return selected.some((label) => sourceSet.has(label.toLowerCase()));
}

function normalizeText(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toSeverity(value: unknown, fallback: Severity): Severity {
  const text = normalizeText(value);
  if (text.includes("crit")) return "critical";
  if (text.includes("alt")) return "high";
  if (text.includes("med")) return "medium";
  if (text.includes("baix")) return "low";
  if (text.includes("info")) return "info";
  return fallback;
}

export function ReportSection({
  criticalGapInsights,
  report,
  reportHistory,
  selectedReportContact,
  onSelectReportContact,
  reportSeverityFilter,
  onChangeReportSeverityFilter,
}: ReportSectionProps) {
  const hasReportData = Boolean(report?.raw_analysis?.analyses?.length) || criticalGapInsights.length > 0;
  const [historyPage, setHistoryPage] = useState(1);
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

  const generatedAtLabel = useMemo(() => {
    const latest = reportHistory[0];
    const dateIso = latest?.finished_at || latest?.started_at || "";
    if (!dateIso) return "--";
    return new Date(dateIso).toLocaleString("pt-BR");
  }, [reportHistory]);

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
    return availableLabels.length > 0 ? availableLabels : DEFAULT_LABEL_HINTS;
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

  const historyChunk = paginate(reportHistory, historyPage, perPage);
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
              <h3 className="report-section-title">Histórico de Execuções</h3>
              {reportHistory.length === 0 ? (
                <p className="empty-state">Sem execuções salvas no banco até agora.</p>
              ) : (
                <>
                  {historyChunk.rows.map((run) => {
                    const reportJson = (run.report_json || {}) as Record<string, unknown>;
                    const rawAnalysis = (reportJson.raw_analysis || {}) as Record<string, unknown>;
                    const rawAnalyses = Array.isArray(rawAnalysis.analyses) ? rawAnalysis.analyses : [];
                    const logs = Array.isArray(reportJson.logs) ? reportJson.logs : [];
                    const logsCount = Number(reportJson.logs_count || 0) || logs.length || rawAnalyses.length;
                    return (
                      <article className="report-card" key={run.id}>
                        <span
                          className="report-card-dot"
                          style={{
                            background:
                              run.status === "completed"
                                ? "var(--ok)"
                                : run.status === "failed"
                                  ? "var(--critical)"
                                  : "var(--azul)",
                          }}
                        />
                        <div className="report-card-content">
                          <h4>
                            {run.date_ref} • {run.channel}
                          </h4>
                          <p>
                            Status: <strong>{run.status}</strong> • Processadas: {run.processed}/{run.total_conversations} • Sucesso:{" "}
                            {run.success_count} • Falhas: {run.failure_count}
                          </p>
                          <p>Logs salvos: {logsCount}</p>
                        </div>
                      </article>
                    );
                  })}
                  {reportHistory.length > perPage ? (
                    <div className="pagination-row">
                      <span>
                        {reportHistory.length} registros • Página {historyChunk.safePage} de {historyChunk.pages}
                      </span>
                      <button
                        type="button"
                        onClick={() => keepScroll(() => setHistoryPage(Math.max(1, historyChunk.safePage - 1)))}
                        disabled={historyChunk.safePage <= 1}
                      >
                        {"<"}
                      </button>
                      <button
                        type="button"
                        onClick={() => keepScroll(() => setHistoryPage(Math.min(historyChunk.pages, historyChunk.safePage + 1)))}
                        disabled={historyChunk.safePage >= historyChunk.pages}
                      >
                        {">"}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>

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
                    <div className="pagination-row">
                      <span>
                        {filteredContactContextItems.length} registros • Página {contextChunk.safePage} de {contextChunk.pages}
                      </span>
                      <button
                        type="button"
                        onClick={() => keepScroll(() => setContextPage(Math.max(1, contextChunk.safePage - 1)))}
                        disabled={contextChunk.safePage <= 1}
                      >
                        {"<"}
                      </button>
                      <button
                        type="button"
                        onClick={() => keepScroll(() => setContextPage(Math.min(contextChunk.pages, contextChunk.safePage + 1)))}
                        disabled={contextChunk.safePage >= contextChunk.pages}
                      >
                        {">"}
                      </button>
                    </div>
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
                    <div className="pagination-row">
                      <span>
                        {filteredGaps.length} registros • Página {gapsChunk.safePage} de {gapsChunk.pages}
                      </span>
                      <button
                        type="button"
                        onClick={() => keepScroll(() => setGapsPage(Math.max(1, gapsChunk.safePage - 1)))}
                        disabled={gapsChunk.safePage <= 1}
                      >
                        {"<"}
                      </button>
                      <button
                        type="button"
                        onClick={() => keepScroll(() => setGapsPage(Math.min(gapsChunk.pages, gapsChunk.safePage + 1)))}
                        disabled={gapsChunk.safePage >= gapsChunk.pages}
                      >
                        {">"}
                      </button>
                    </div>
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







