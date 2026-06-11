import { useMemo, useState } from "react";
import { toTitleCaseName } from "../../hooks/controller/common";
import { buildConversationUrl, normalizeChatwootAppBase } from "../../shared/helpers";
import { preserveWindowScroll } from "../../shared/scroll";
import { normalizeSeverity, severityColors, severityLabel } from "../../shared/constants";
import { HileCardGrid, HileEmptyPanel, HileKpiCard, HileSectionShell, HileSurfaceCard } from "../../shared/ui/HilePrimitives";
import type { OperationalAlertItem } from "../../shared/types";

interface DissatisfactionViewProps {
  selectedDate: string;
  alerts: OperationalAlertItem[];
  onOpenReportByContact: (contactName: string) => void;
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

export function DissatisfactionView({
  selectedDate,
  alerts,
  onOpenReportByContact,
  chatwootBaseUrl = "",
  chatwootAccountId = 0,
  chatwootInboxId = 0,
  headerNumber = "01",
}: DissatisfactionViewProps) {
  const [typeFilter, setTypeFilter] = useState<AlertTypeFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<AlertSeverityFilter>("all");
  const [page, setPage] = useState(1);
  const perPage = 8;

  const dissatisfactionAlerts = useMemo(
    () =>
      alerts
        .filter((item) => item.type === "desengajamento")
        .sort((a, b) => {
          const aTime = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
          const bTime = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
          return bTime - aTime;
        }),
    [alerts],
  );

  const filteredAlerts = useMemo(() => {
    return dissatisfactionAlerts.filter((item) => {
      const itemType = item.category === "insatisfacao_hile" ? "insatisfacao_hile" : "insatisfacao_atendimento";
      const byType = typeFilter === "all" || itemType === typeFilter;
      const bySeverity = severityFilter === "all" || item.severity === severityFilter;
      return byType && bySeverity;
    });
  }, [dissatisfactionAlerts, severityFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paged = filteredAlerts.slice((safePage - 1) * perPage, safePage * perPage);

  const summary = useMemo(() => {
    const critical = dissatisfactionAlerts.filter((item) => item.severity === "critical").length;
    const high = dissatisfactionAlerts.filter((item) => item.severity === "high").length;
    const uniqueContacts = new Set(dissatisfactionAlerts.map((item) => String(item.contactName || "").trim()).filter(Boolean)).size;
    return { total: dissatisfactionAlerts.length, critical, high, uniqueContacts };
  }, [dissatisfactionAlerts]);
  const normalizedChatwootBase = normalizeChatwootAppBase(chatwootBaseUrl);

  return (
    <section className="accounts-shell dissatisfaction-shell">
      <div className="section-inner reveal" id="dissatisfaction-overview">
        <HileSectionShell
          eyebrow={headerNumber}
          title="Registro de Insatisfação"
          description={`Visão auditável dos sinais de insatisfação detectados no dia ${selectedDate}.`}
        >
          <div className="hile-section-stack">
            <HileCardGrid cols={4}>
              <HileKpiCard label="Ocorrências" value={summary.total} hint="Sinais detectados no dia" tone={summary.total > 0 ? "accent" : "default"} accent="accent" />
              <HileKpiCard label="Clientes impactados" value={summary.uniqueContacts} hint="Contatos únicos afetados" />
              <HileKpiCard label="Críticos" value={summary.critical} hint="Casos de maior severidade" tone={summary.critical > 0 ? "critical" : "default"} accent={summary.critical > 0 ? "critical" : "default"} />
              <HileKpiCard label="Altos" value={summary.high} hint="Ocorrências em nível alto" tone={summary.high > 0 ? "critical" : "default"} accent={summary.high > 0 ? "high" : "default"} />
            </HileCardGrid>

            <div id="dissatisfaction-filters" style={{ scrollMarginTop: "96px" }}>
              <HileSurfaceCard title="Filtros" description="Refine a leitura por tipo e severidade." tone="accent">
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
              <HileSurfaceCard title="Ocorrências" description={`${filteredAlerts.length} registro(s) encontrados para os filtros atuais`} tone={paged.length > 0 ? "default" : "soft"}>
              {paged.length === 0 ? (
                <HileEmptyPanel title="Sem ocorrências para os filtros aplicados" description="Quando houver novos sinais de insatisfação neste recorte, eles aparecerão aqui." />
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
