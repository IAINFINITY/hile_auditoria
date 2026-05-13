import { useMemo, useState } from "react";
import type { InsightItem, ReportPayload } from "../../../types";

interface ReportSectionProps {
  allInsights: InsightItem[];
  criticalGapInsights: InsightItem[];
  report: ReportPayload | null;
  selectedReportContact: string | null;
  setSelectedReportContact: (value: string | null) => void;
}

interface ReportItem {
  key: string;
  title: string;
  desc: string;
  tone: "critical" | "high" | "info";
}

interface ContactContextItem {
  key: string;
  contactName: string;
  situacao: string;
  contexto: string;
  evidencia: string;
  risco: string;
  acao: string;
}

function toneColor(tone: ReportItem["tone"]): string {
  if (tone === "critical") return "var(--critical)";
  if (tone === "high") return "var(--high)";
  return "var(--azul)";
}

function paginate<T>(items: T[], page: number, perPage: number): { rows: T[]; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * perPage;
  return { rows: items.slice(start, start + perPage), pages };
}

export function ReportSection({
  allInsights,
  criticalGapInsights,
  report,
  selectedReportContact,
  setSelectedReportContact,
}: ReportSectionProps) {
  const hasReportData = Boolean(report?.raw_analysis?.analyses?.length) || allInsights.length > 0 || criticalGapInsights.length > 0;
  const [achadosPage, setAchadosPage] = useState(1);
  const [gapsPage, setGapsPage] = useState(1);
  const [recomPage, setRecomPage] = useState(1);
  const [situationFilter, setSituationFilter] = useState<string>("all");
  const [queryFilter, setQueryFilter] = useState<string>("");
  const perPage = 3;

  const achados = useMemo<ReportItem[]>(() => {
    const source = criticalGapInsights.slice(0, 100);
    return source.map((item) => ({
      key: `achado-${item.id}`,
      title: item.title,
      desc: `${item.contact_name} • Conversa ${item.conversation_id} • ${item.summary}`,
      tone: item.severity === "critical" ? "critical" : "high",
    }));
  }, [criticalGapInsights]);

  const reportGaps = useMemo<ReportItem[]>(() => {
    return criticalGapInsights.map((item) => ({
      key: `gap-${item.id}`,
      title: item.severity === "critical" ? "Gap Crítico" : "Gap Alto",
      desc: `${item.contact_name}: ${item.summary}`,
      tone: item.severity === "critical" ? "critical" : "high",
    }));
  }, [criticalGapInsights]);

  const recomendacoes = useMemo<ReportItem[]>(() => {
    return allInsights
      .filter((item) => item.severity === "medium" || item.severity === "low" || item.severity === "info")
      .slice(0, 100)
      .map((item) => ({
        key: `recom-${item.id}`,
        title: item.title,
        desc: `${item.contact_name} • ${item.summary}`,
        tone: "info",
      }));
  }, [allInsights]);

  const contextOverview = useMemo(() => {
    const analyses = report?.raw_analysis?.analyses || [];
    if (analyses.length === 0) return [] as string[];

    const tags = new Map<string, number>();
    let waitingOnAgentCount = 0;

    for (const analysis of analyses) {
      const state = analysis.conversation_operational?.[0]?.state;
      if (state?.waiting_on_agent) waitingOnAgentCount += 1;

      for (const line of String(analysis.log_text || "").split("\n")) {
        const matches = line.match(/\[etiquetas:\s*([^\]]+)\]/i);
        if (!matches?.[1]) continue;
        const values = matches[1].split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
        for (const value of values) {
          tags.set(value, (tags.get(value) || 0) + 1);
        }
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
        const answer = String(analysis.analysis?.answer || "");
        let parsed: Record<string, unknown> = {};

        try {
          parsed = JSON.parse(answer);
        } catch {
          parsed = {};
        }

        const toList = (value: unknown): string[] => (Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []);
        const contactName = analysis.contact?.name || analysis.contact?.identifier || analysis.contact_key;
        const resumo = String(parsed.resumo || "Sem resumo estruturado.");
        const melhorias = toList(parsed.pontos_melhoria);
        const proximos = toList(parsed.proximos_passos);
        const riscoCritico = Boolean(parsed.risco_critico);
        const state = analysis.conversation_operational?.[0]?.state;
        const situacao = state?.finalization_status === "finalizada"
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

        return {
          key: `${analysis.contact_key}-${analysis.analysis_index || 0}`,
          contactName,
          situacao,
          contexto: resumo,
          evidencia,
          risco: riscoCritico ? "Crítico" : "Não crítico",
          acao: proximos[0] || melhorias[0] || "Sem ação recomendada no retorno da IA.",
        };
      });
  }, [report]);

  const userOptions = useMemo<string[]>(
    () => Array.from(new Set(contactContextItems.map((item) => item.contactName))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [contactContextItems],
  );
  const situationOptions = useMemo<string[]>(
    () => Array.from(new Set(contactContextItems.map((item) => item.situacao))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [contactContextItems],
  );

  const q = queryFilter.trim().toLowerCase();
  const filteredContactContextItems = useMemo<ContactContextItem[]>(() => {
    return contactContextItems.filter((item) => {
      const byUser = !selectedReportContact || item.contactName === selectedReportContact;
      const bySituation = situationFilter === "all" || item.situacao === situationFilter;
      const haystack = `${item.contactName} ${item.situacao} ${item.contexto} ${item.evidencia} ${item.risco} ${item.acao}`.toLowerCase();
      const byQuery = !q || haystack.includes(q);
      return byUser && bySituation && byQuery;
    });
  }, [contactContextItems, q, selectedReportContact, situationFilter]);

  const filteredAchados = useMemo<ReportItem[]>(() => {
    return achados.filter((item) => {
      const byUser = !selectedReportContact || item.desc.toLowerCase().includes(selectedReportContact.toLowerCase());
      const byQuery = !q || `${item.title} ${item.desc}`.toLowerCase().includes(q);
      return byUser && byQuery;
    });
  }, [achados, q, selectedReportContact]);

  const filteredGaps = useMemo<ReportItem[]>(() => {
    return reportGaps.filter((item) => {
      const byUser = !selectedReportContact || item.desc.toLowerCase().includes(selectedReportContact.toLowerCase());
      const byQuery = !q || `${item.title} ${item.desc}`.toLowerCase().includes(q);
      return byUser && byQuery;
    });
  }, [q, reportGaps, selectedReportContact]);

  const filteredRecomendacoes = useMemo<ReportItem[]>(() => {
    return recomendacoes.filter((item) => {
      const byUser = !selectedReportContact || item.desc.toLowerCase().includes(selectedReportContact.toLowerCase());
      const byQuery = !q || `${item.title} ${item.desc}`.toLowerCase().includes(q);
      return byUser && byQuery;
    });
  }, [q, recomendacoes, selectedReportContact]);

  const achadosChunk = paginate(filteredAchados, achadosPage, perPage);
  const gapsChunk = paginate(filteredGaps, gapsPage, perPage);
  const recomChunk = paginate(filteredRecomendacoes, recomPage, perPage);

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
            <span>Gerado em: {new Date().toLocaleString("pt-BR")}</span>
          </div>

          <div className="metrics-block-body">
            <div className="report-section-sep">
              <h3 className="report-section-title">Filtros do Relatório</h3>
              <div className="btn-group">
                <select
                  value={selectedReportContact || "all"}
                  onChange={(event) => setSelectedReportContact(event.target.value === "all" ? null : event.target.value)}
                >
                  <option value="all">Todos os usuários</option>
                  {userOptions.map((user) => (
                    <option value={user} key={user}>
                      {user}
                    </option>
                  ))}
                </select>
                <select value={situationFilter} onChange={(event) => setSituationFilter(event.target.value)}>
                  <option value="all">Todas as situações</option>
                  {situationOptions.map((situation) => (
                    <option value={situation} key={situation}>
                      {situation}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={queryFilter}
                  onChange={(event) => setQueryFilter(event.target.value)}
                  placeholder="Buscar por qualquer termo..."
                />
              </div>
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
              <h3 className="report-section-title">Contexto por Usuário</h3>
              {filteredContactContextItems.length === 0 ? (
                <p className="empty-state">Sem dados por usuário no momento.</p>
              ) : (
                filteredContactContextItems.map((item) => (
                  <article className="report-card" key={item.key}>
                    <span className="report-card-dot" style={{ background: item.risco === "Crítico" ? "var(--critical)" : "var(--azul)" }} />
                    <div className="report-card-content">
                      <h4>{item.contactName}</h4>
                      <p><strong>Situação:</strong> {item.situacao}</p>
                      <p><strong>Contexto:</strong> {item.contexto}</p>
                      <p><strong>Evidência:</strong> {item.evidencia}</p>
                      <p><strong>Risco:</strong> {item.risco}</p>
                      <p><strong>Ação recomendada:</strong> {item.acao}</p>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="report-section-sep">
              <h3 className="report-section-title">Achados Críticos</h3>
              {achadosChunk.rows.length === 0 ? (
                <p className="empty-state">Nenhum achado crítico disponível.</p>
              ) : (
                <>
                  {achadosChunk.rows.map((item) => (
                    <article className="report-card" key={item.key}>
                      <span className="report-card-dot" style={{ background: toneColor(item.tone) }} />
                      <div className="report-card-content">
                        <h4>{item.title}</h4>
                        <p>{item.desc}</p>
                      </div>
                    </article>
                  ))}
                  {achadosChunk.pages > 1 ? (
                    <div className="pagination-row">
                      <span>Pág. {Math.min(achadosPage, achadosChunk.pages)} de {achadosChunk.pages}</span>
                      <button onClick={() => setAchadosPage((p) => Math.max(1, p - 1))} disabled={achadosPage <= 1}>‹</button>
                      <button onClick={() => setAchadosPage((p) => Math.min(achadosChunk.pages, p + 1))} disabled={achadosPage >= achadosChunk.pages}>›</button>
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
                  {gapsChunk.rows.map((item) => (
                    <article className="report-card" key={item.key}>
                      <span className="report-card-dot" style={{ background: toneColor(item.tone) }} />
                      <div className="report-card-content">
                        <h4>{item.title}</h4>
                        <p>{item.desc}</p>
                      </div>
                    </article>
                  ))}
                  {gapsChunk.pages > 1 ? (
                    <div className="pagination-row">
                      <span>Pág. {Math.min(gapsPage, gapsChunk.pages)} de {gapsChunk.pages}</span>
                      <button onClick={() => setGapsPage((p) => Math.max(1, p - 1))} disabled={gapsPage <= 1}>‹</button>
                      <button onClick={() => setGapsPage((p) => Math.min(gapsChunk.pages, p + 1))} disabled={gapsPage >= gapsChunk.pages}>›</button>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="report-section-sep">
              <h3 className="report-section-title">Recomendações</h3>
              {recomChunk.rows.length === 0 ? (
                <p className="empty-state">Sem recomendações para o período atual.</p>
              ) : (
                <>
                  {recomChunk.rows.map((item) => (
                    <article className="report-card" key={item.key}>
                      <span className="report-card-dot" style={{ background: toneColor(item.tone) }} />
                      <div className="report-card-content">
                        <h4>{item.title}</h4>
                        <p>{item.desc}</p>
                      </div>
                    </article>
                  ))}
                  {recomChunk.pages > 1 ? (
                    <div className="pagination-row">
                      <span>Pág. {Math.min(recomPage, recomChunk.pages)} de {recomChunk.pages}</span>
                      <button onClick={() => setRecomPage((p) => Math.max(1, p - 1))} disabled={recomPage <= 1}>‹</button>
                      <button onClick={() => setRecomPage((p) => Math.min(recomChunk.pages, p + 1))} disabled={recomPage >= recomChunk.pages}>›</button>
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
