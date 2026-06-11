import { useEffect, useMemo, useState } from "react";
import type { DissatisfactionOverallResponse } from "../../../../types";
import { apiGet } from "@/lib/api";
import { toTitleCaseName } from "../../hooks/controller/common";
import { buildConversationUrl, normalizeChatwootAppBase } from "../../shared/helpers";
import { preserveWindowScroll } from "../../shared/scroll";
import { normalizeSeverity, severityColors, severityLabel } from "../../shared/constants";
import { HileCardGrid, HileEmptyPanel, HileKpiCard, HileSectionShell, HileSurfaceCard } from "../../shared/ui/HilePrimitives";
import type { OperationalAlertItem } from "../../shared/types";

interface DissatisfactionOverallViewProps {
  onOpenReportByContact: (contactName: string) => void;
  refreshHint?: string | null;
  chatwootBaseUrl?: string;
  chatwootAccountId?: number;
  chatwootInboxId?: number;
  headerNumber?: string;
}

type AlertTypeFilter = "all" | "insatisfacao_hile" | "insatisfacao_atendimento";
type AlertSeverityFilter = "all" | "critical" | "high" | "medium";

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR", { timeZone: "America/Fortaleza" });
}

function typeLabel(type: AlertTypeFilter): string {
  if (type === "insatisfacao_hile") return "Insatisfação com a Hile";
  if (type === "insatisfacao_atendimento") return "Insatisfação com atendimento";
  return "Todos";
}

function severityColor(severity: string | null | undefined): string {
  return severityColors[normalizeSeverity(severity, "info")];
}

function typeColor(type: AlertTypeFilter): string {
  if (type === "insatisfacao_hile") return "var(--critical)";
  if (type === "insatisfacao_atendimento") return "var(--high)";
  return "var(--azul-line)";
}

export function DissatisfactionOverallView({
  onOpenReportByContact,
  refreshHint,
  chatwootBaseUrl = "",
  chatwootAccountId = 0,
  chatwootInboxId = 0,
  headerNumber = "01",
}: DissatisfactionOverallViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<DissatisfactionOverallResponse | null>(null);
  const [typeFilter, setTypeFilter] = useState<AlertTypeFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<AlertSeverityFilter>("all");
  const [page, setPage] = useState(1);
  const perPage = 8;

  useEffect(() => {
    let cancelled = false;
    apiGet<DissatisfactionOverallResponse>("/api/dissatisfaction/overall?limit=500")
      .then((data) => {
        if (cancelled) return;
        setError("");
        setPayload(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar insatisfação geral.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshHint]);

  const alerts = useMemo(() => {
    const base = (payload?.alerts || []) as OperationalAlertItem[];
    return base.sort((a, b) => {
      const aTime = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
      const bTime = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [payload?.alerts]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((item) => {
      const itemType = item.category === "insatisfacao_hile" ? "insatisfacao_hile" : "insatisfacao_atendimento";
      const byType = typeFilter === "all" || itemType === typeFilter;
      const bySeverity = severityFilter === "all" || item.severity === severityFilter;
      return byType && bySeverity;
    });
  }, [alerts, severityFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paged = filteredAlerts.slice((safePage - 1) * perPage, safePage * perPage);
  const summary = payload?.summary || { total: 0, critical: 0, high: 0, medium: 0, unique_contacts: 0 };
  const normalizedChatwootBase = normalizeChatwootAppBase(chatwootBaseUrl);

  return (
    <section className="accounts-shell dissatisfaction-shell">
      <div className="section-inner reveal" id="dissatisfaction-overview">
        <HileSectionShell
          eyebrow={headerNumber}
          title="Registro de Insatisfação (Geral)"
          description={
            payload?.date_range?.from && payload?.date_range?.to
              ? `Consolidado de todas as execuções salvas entre ${payload.date_range.from} e ${payload.date_range.to}.`
              : "Consolidado de todas as execuções salvas."
          }
        >
          <div className="hile-section-stack">
            <HileCardGrid cols={4}>
              <HileKpiCard label="Ocorrências" value={summary.total} hint="Sinais salvos no consolidado" tone={summary.total > 0 ? "accent" : "default"} accent="accent" />
              <HileKpiCard label="Clientes impactados" value={summary.unique_contacts} hint="Contatos únicos afetados" />
              <HileKpiCard label="Críticos" value={summary.critical} hint="Casos de maior severidade" tone={summary.critical > 0 ? "critical" : "default"} accent={summary.critical > 0 ? "critical" : "default"} />
              <HileKpiCard label="Execuções" value={payload?.total_runs || 0} hint="Rodadas consideradas no consolidado" />
            </HileCardGrid>

            <div id="dissatisfaction-filters" style={{ scrollMarginTop: "96px" }}>
              <HileSurfaceCard title="Filtros" description="Refine a leitura do consolidado por tipo e severidade." tone="accent">
              <div className="accounts-filters">
                <div className="accounts-filter-row">
                  <label>
                    Tipo
                    <select
                      value={typeFilter}
                      onChange={(event) =>
                        preserveWindowScroll(() => {
                          setTypeFilter(event.target.value as AlertTypeFilter);
                          setPage(1);
                        })
                      }
                    >
                      <option value="all">{typeLabel("all")}</option>
                      <option value="insatisfacao_hile">{typeLabel("insatisfacao_hile")}</option>
                      <option value="insatisfacao_atendimento">{typeLabel("insatisfacao_atendimento")}</option>
                    </select>
                  </label>
                  <label>
                    Severidade
                    <select
                      value={severityFilter}
                      onChange={(event) =>
                        preserveWindowScroll(() => {
                          setSeverityFilter(event.target.value as AlertSeverityFilter);
                          setPage(1);
                        })
                      }
                    >
                      <option value="all">Todas</option>
                      <option value="critical">{severityLabel.critical}</option>
                      <option value="high">Alto</option>
                      <option value="medium">{severityLabel.medium}</option>
                    </select>
                  </label>
                </div>
              </div>
            </HileSurfaceCard>
            </div>

            <div id="dissatisfaction-list" style={{ scrollMarginTop: "96px" }}>
              <HileSurfaceCard title="Ocorrências" description={`${filteredAlerts.length} registro(s) encontrados no consolidado filtrado`} tone={paged.length > 0 ? "default" : "soft"}>
              {loading ? (
                <HileEmptyPanel title="Carregando insatisfação geral" description="Estamos preparando o consolidado salvo mais recente." />
              ) : error ? (
                <HileEmptyPanel title="Falha ao carregar insatisfação geral" description={error} />
              ) : paged.length === 0 ? (
                <HileEmptyPanel title="Sem ocorrências para os filtros aplicados" description="Quando houver novos casos neste recorte, eles aparecerão aqui." />
              ) : (
                <div className="report-list-animated">
                  {paged.map((item) => {
                    const alertType: AlertTypeFilter = item.category === "insatisfacao_hile" ? "insatisfacao_hile" : "insatisfacao_atendimento";
                    const conversationId = Number(item.conversationId || 0);
                    const chatwootLink =
                      normalizedChatwootBase && chatwootAccountId > 0 && chatwootInboxId > 0 && conversationId > 0
                        ? buildConversationUrl(normalizedChatwootBase, chatwootAccountId, chatwootInboxId, conversationId)
                        : null;
                    return (
                      <article className="report-card" key={item.id}>
                        <span className="report-card-dot" style={{ background: severityColor(item.severity) }} />
                        <div className="report-card-content">
                          <h4>{typeLabel(alertType)}</h4>
                          <p>
                            <strong>{toTitleCaseName(item.contactName || "")}</strong> • conversa #{item.conversationId || "-"}
                          </p>
                          <p className="dissatisfaction-meta-row">
                            <span className="dissatisfaction-type-chip" style={{ borderColor: typeColor(alertType), color: typeColor(alertType) }}>
                              {typeLabel(alertType)}
                            </span>
                            <span className="dissatisfaction-meta-severity" style={{ color: severityColor(item.severity) }}>
                              {severityLabel[normalizeSeverity(item.severity, "info")]}
                            </span>
                          </p>
                          <p><strong>Momento:</strong> {formatDateTime(item.occurredAt)}</p>
                          <p><strong>Evidência:</strong> {item.excerpt}</p>
                          <button type="button" className="link-btn link-btn-spaced" onClick={() => onOpenReportByContact(item.contactName)}>
                            Ver relatório desta pessoa
                          </button>
                          {chatwootLink ? (
                            <a className="link-btn link-btn-spaced" href={chatwootLink} target="_blank" rel="noreferrer">
                              Ver no Chatwoot
                            </a>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {filteredAlerts.length > perPage ? (
                <div className="pagination-row">
                  <span>
                    {filteredAlerts.length} registros • Página {safePage} de {totalPages}
                  </span>
                  <button type="button" onClick={() => preserveWindowScroll(() => setPage(Math.max(1, safePage - 1)))} disabled={safePage <= 1}>
                    {"<"}
                  </button>
                  <button type="button" onClick={() => preserveWindowScroll(() => setPage(Math.min(totalPages, safePage + 1)))} disabled={safePage >= totalPages}>
                    {">"}
                  </button>
                </div>
              ) : null}
            </HileSurfaceCard>
            </div>
          </div>
        </HileSectionShell>
      </div>
    </section>
  );
}
