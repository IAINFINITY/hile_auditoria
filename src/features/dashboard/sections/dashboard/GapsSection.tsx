import { useMemo, useState } from "react";
import type { InsightItem, OverviewPayload } from "../../../../types";
import type { OperationalAlertItem } from "../../shared/types";
import { toTitleCaseName } from "../../hooks/controller/common";

interface GapsSectionProps {
  insightsReady: boolean;
  criticalGapInsights: InsightItem[];
  overview: OverviewPayload | null;
  chatwootBaseUrl: string;
  onOpenReportByContact: (contactName: string) => void;
  operationalAlerts: OperationalAlertItem[];
}

type GapFilter = "todos" | "critical" | "high";

function toChatwootAppBase(baseUrl: string): string {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "").replace(/\/api\/v1(?:\/.*)?$/i, "").replace(/\/api(?:\/.*)?$/i, "");
}

function buildConversationLink(
  baseUrl: string,
  accountId: number,
  inboxId: number,
  conversationId: number,
): string | null {
  if (!baseUrl || !accountId || !inboxId || !conversationId) return null;
  return `${baseUrl}/app/accounts/${accountId}/inbox/${inboxId}/conversations/${conversationId}`;
}

function severityLabel(severity: string) {
  return severity === "critical" ? "crítico" : "alto";
}

function severityColor(severity: string): string {
  return severity === "critical" ? "var(--critical)" : "var(--high)";
}

function conciseGapHeadline(title: string, summary: string): string {
  const source = `${String(title || "")} ${String(summary || "")}`.toLowerCase();

  if (source.includes("lentidao") || source.includes("atraso") || source.includes("demor")) {
    return "Ocorreu atraso no atendimento.";
  }
  if (source.includes("abandono") || source.includes("sem resposta")) {
    return "Cliente ficou sem resposta.";
  }
  if (source.includes("pedido_consultor") || source.includes("consultor") || source.includes("atendente")) {
    return "Pedido de consultor não foi atendido.";
  }
  if (source.includes("transferencia") || source.includes("transferência")) {
    return "A transferência não ocorreu como esperado.";
  }
  if (source.includes("agendamento") && (source.includes("incorreto") || source.includes("erro"))) {
    return "Houve erro no agendamento.";
  }
  if (source.includes("falha_envio_confirmacao") || source.includes("não recebeu") || source.includes("nao recebeu")) {
    return "Cliente não recebeu a confirmação.";
  }
  if (source.includes("dado_incorreto") || source.includes("valor") && source.includes("conflito")) {
    return "Foi identificado conflito de dados.";
  }
  if (source.includes("resolucao_prematura") || source.includes("resolução prematura")) {
    return "A conversa foi encerrada sem conclusão.";
  }

  const sentence = String(summary || title || "").replace(/\s+/g, " ").trim().split(/[.!?]/)[0]?.trim() || "";
  if (!sentence) return "Atenção operacional identificada.";
  if (sentence.length <= 80) return sentence.endsWith(".") ? sentence : `${sentence}.`;
  return `${sentence.slice(0, 77).trimEnd()}...`;
}

function cleanedSentence(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim().split(/[.!?]/)[0]?.trim() || "";
}

function isGenericHeadline(value: string): boolean {
  const normalized = normalizeCompareText(value);
  if (!normalized) return true;
  return (
    normalized.includes("a analise da conversa identificou") ||
    normalized.includes("analise da conversa identificou") ||
    normalized.includes("a conversa apresentou") ||
    normalized.includes("foi identificado um gap") ||
    normalized.includes("gap registrado") ||
    normalized.includes("problema aberto") ||
    normalized.includes("atencao operacional") ||
    normalized.includes("insight registrado")
  );
}

function smartGapHeadline(title: string, summary: string): string {
  const titleSentence = cleanedSentence(title);
  const hasTruncation = String(title || "").includes("...");
  if (!isGenericHeadline(titleSentence) && !hasTruncation && titleSentence.length >= 14 && titleSentence.length <= 96) {
    return titleSentence.endsWith(".") ? titleSentence : `${titleSentence}.`;
  }
  return conciseGapHeadline(title, summary);
}

function normalizeCompareText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldShowGapReason(headline: string, summary: string): boolean {
  const titleNorm = normalizeCompareText(headline);
  const summaryNorm = normalizeCompareText(summary);
  if (!summaryNorm) return false;
  if (!titleNorm) return true;
  if (titleNorm === summaryNorm) return false;
  if (titleNorm.length >= 24 && summaryNorm.startsWith(titleNorm)) return false;
  if (summaryNorm.length >= 24 && titleNorm.startsWith(summaryNorm)) return false;
  return true;
}

function labelClass(tag: string): string {
  const value = String(tag || "").toLowerCase();
  if (value.includes("lead_agendado")) return "tag tag-ok";
  if (value.includes("pausar_ia")) return "tag tag-pause";
  if (value.includes("quente")) return "tag tag-warm";
  return "tag";
}

export function GapsSection({
  insightsReady,
  criticalGapInsights,
  overview,
  chatwootBaseUrl,
  onOpenReportByContact,
  operationalAlerts,
}: GapsSectionProps) {
  const [filter, setFilter] = useState<GapFilter>("todos");
  const [page, setPage] = useState(1);
  const [animationSeed, setAnimationSeed] = useState(0);
  const perPage = 5;
  const accountId = Number(overview?.account?.id || 0);
  const inboxId = Number(overview?.inbox?.id || 0);
  const baseUrl = toChatwootAppBase(chatwootBaseUrl);

  const filtered = useMemo(() => {
    if (filter === "todos") return criticalGapInsights;
    return criticalGapInsights.filter((item) => item.severity === filter);
  }, [criticalGapInsights, filter]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filtered.length / perPage)), [filtered.length]);
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [filtered, safePage]);

  function keepScroll(update: () => void) {
    const y = typeof window !== "undefined" ? window.scrollY : 0;
    update();
    if (typeof window !== "undefined") {
      requestAnimationFrame(() => {
        window.scrollTo({ top: y, behavior: "auto" });
        requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "auto" }));
      });
    }
  }

  function handleFilterChange(next: GapFilter) {
    setFilter(next);
    setPage(1);
    setAnimationSeed((value) => value + 1);
  }

  return (
    <div className="section reveal" id="gaps">
      <div className="section-inner">
        <div className="section-header">
          <span className="section-num">02</span>
          <div className="section-title">
            <h2>Gaps Identificados</h2>
            <p>Lista de gaps críticos e altos com foco no que precisa de ação</p>
          </div>
        </div>

        <div className={`metrics-block ${insightsReady ? "" : "data-dim"}`}>
          <div className="metrics-block-header">
            <span>Crítico e alto</span>
            <span>{filtered.length} ocorrências</span>
          </div>
          <div className="metrics-block-body">
            <div className="btn-group" style={{ marginBottom: 14 }}>
              <button type="button" className={`gap-chip ${filter === "todos" ? "active" : ""}`} onClick={() => handleFilterChange("todos")}>
                Todos
              </button>
              <button
                type="button"
                className={`gap-chip ${filter === "critical" ? "active" : ""}`}
                onClick={() => handleFilterChange("critical")}
              >
                Crítico
              </button>
              <button type="button" className={`gap-chip ${filter === "high" ? "active" : ""}`} onClick={() => handleFilterChange("high")}>
                Alto
              </button>
            </div>

            {!insightsReady ? (
              <p className="empty-state">Rode o overview para preencher os gaps identificados.</p>
            ) : filtered.length === 0 ? (
              <p className="empty-state">Nenhum gap no filtro selecionado.</p>
            ) : (
              <div className="gaps-grid gaps-grid-animated" key={`${filter}-${safePage}-${animationSeed}`}>
                {pagedItems.map((item) => {
                  const url = buildConversationLink(baseUrl, accountId, inboxId, item.conversation_id);
                  const contactName = toTitleCaseName(item.contact_name || "");
                  const headline = smartGapHeadline(item.title, item.summary);
                  const showReason = shouldShowGapReason(headline, item.summary);
                  return (
                    <article className={`gap-item ${item.severity}`} key={item.id}>
                      <div className="gap-color-bar" />
                      <div className="gap-card-body">
                        <div className="gap-top">
                          <span className="gap-severity" style={{ color: severityColor(item.severity) }}>
                            {severityLabel(item.severity)}
                          </span>
                          <span style={{ fontSize: "var(--fs-small)", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                            #{item.conversation_id}
                          </span>
                        </div>

                        <div style={{ fontSize: "var(--fs-h3)", fontWeight: 700, color: "var(--navy)", margin: "4px 0 2px" }}>
                          {headline}
                        </div>

                        <div className="gap-contact">
                          <strong>{contactName}</strong>
                          <span>• Conversa #{item.conversation_id}</span>
                          <button type="button" className="link-btn" onClick={() => onOpenReportByContact(contactName)}>
                            Ver detalhes desta pessoa
                          </button>
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer">
                              Ver no Chatwoot →
                            </a>
                          ) : null}
                        </div>

                        {showReason ? (
                          <>
                            <hr className="gap-divider" />
                            <p className="gap-reason">{item.summary}</p>
                          </>
                        ) : null}

                        <div className="gap-label-row">
                          {(item.labels || []).length > 0 ? (
                            (item.labels || []).map((tag) => (
                              <span className={labelClass(tag)} key={`${item.id}-${tag}`}>
                                {tag}
                              </span>
                            ))
                          ) : (
                            <span className="tag">sem etiqueta</span>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {filtered.length > perPage ? (
              <div className="pagination-row">
                <span>
                  {filtered.length} registros • Página {safePage} de {totalPages}
                </span>
                <button type="button" onClick={() => keepScroll(() => setPage(Math.max(1, safePage - 1)))} disabled={safePage <= 1}>
                  {"<"}
                </button>
                <button
                  type="button"
                  onClick={() => keepScroll(() => setPage(Math.min(totalPages, safePage + 1)))}
                  disabled={safePage >= totalPages}
                >
                  {">"}
                </button>
              </div>
            ) : null}

            {insightsReady ? (
              <div className="report-section-sep" style={{ marginTop: 18 }}>
                <h3 className="report-section-title">Pontos de atenção operacional</h3>
                {operationalAlerts.length === 0 ? (
                  <p className="empty-state">Sem alertas de consultor ou insatisfação no período.</p>
                ) : (
                  <div className="report-list-animated">
                    {operationalAlerts.slice(0, 10).map((alert) => (
                      <article className="report-card" key={alert.id}>
                        <span
                          className="report-card-dot"
                          style={{ background: alert.type === "desengajamento" ? "var(--critical)" : "var(--high)" }}
                        />
                        <div className="report-card-content">
                          <h4>{alert.type === "desengajamento" ? "Risco de desengajamento" : "Pedido de consultor"}</h4>
                          <p>
                            <strong>{toTitleCaseName(alert.contactName || "")}</strong> • conversa #{alert.conversationId || "-"}
                          </p>
                          <p>{alert.excerpt}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
