import { useEffect, useMemo, useState } from "react";
import type { InsightItem, OverviewPayload } from "../../../types";

interface GapsSectionProps {
  insightsReady: boolean;
  criticalGapInsights: InsightItem[];
  overview: OverviewPayload | null;
  chatwootBaseUrl: string;
  onOpenReportByContact: (contactName: string) => void;
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

  useEffect(() => {
    setPage(1);
  }, [filter, criticalGapInsights.length]);

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
      requestAnimationFrame(() => window.scrollTo({ top: y }));
    }
  }

  function handleFilterChange(next: GapFilter) {
    setFilter(next);
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
                          {item.title}
                        </div>

                        <div className="gap-contact">
                          <strong>{item.contact_name}</strong>
                          <span>• Conversa #{item.conversation_id}</span>
                          <button type="button" className="link-btn" onClick={() => onOpenReportByContact(item.contact_name)}>
                            Ver relatório desta pessoa
                          </button>
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer">
                              Ver no Chatwoot →
                            </a>
                          ) : null}
                        </div>

                        <hr className="gap-divider" />
                        <p className="gap-reason">{item.summary}</p>

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
          </div>
        </div>
      </div>
    </div>
  );
}
