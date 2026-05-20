import { useMemo, useState } from "react";
import { toTitleCaseName } from "../../hooks/controller/common";
import type { OperationalAlertItem } from "../../shared/types";

interface DissatisfactionViewProps {
  selectedDate: string;
  alerts: OperationalAlertItem[];
  onOpenReportByContact: (contactName: string) => void;
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
  if (type === "insatisfacao_hile") return "Insatisfação com a Hilê";
  if (type === "insatisfacao_atendimento") return "Insatisfação com atendimento";
  return "Todos";
}

function severityLabel(severity: string | null | undefined): string {
  if (severity === "critical") return "Crítico";
  if (severity === "high") return "Alto";
  if (severity === "medium") return "Médio";
  return "Informativo";
}

function severityColor(severity: string | null | undefined): string {
  if (severity === "critical") return "var(--critical)";
  if (severity === "high") return "var(--high)";
  if (severity === "medium") return "var(--medium)";
  return "var(--info)";
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

  return (
    <section className="accounts-shell dissatisfaction-shell">
      <div className="section-inner reveal" id="dissatisfaction-overview">
        <div className="section-header">
          <span className="section-num">{headerNumber}</span>
          <div className="section-title">
            <h2>Registro de Insatisfação</h2>
            <p>Visão auditável dos sinais de insatisfação detectados no dia {selectedDate}.</p>
          </div>
        </div>
      </div>

      <article className={`settings-card ${summary.total === 0 ? "data-dim" : ""}`}>
        <div className="settings-card-head">Panorama do dia</div>
        <div className="settings-card-body dissatisfaction-kpis">
          <p><strong>Ocorrências:</strong> {summary.total}</p>
          <p><strong>Clientes impactados:</strong> {summary.uniqueContacts}</p>
          <p><strong>Críticos:</strong> {summary.critical}</p>
          <p><strong>Altos:</strong> {summary.high}</p>
        </div>
      </article>

      <article className="settings-card" id="dissatisfaction-filters">
        <div className="settings-card-head">Filtros</div>
        <div className="settings-card-body accounts-filters">
          <div className="accounts-filter-row">
            <label>
              Tipo
              <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value as AlertTypeFilter); setPage(1); }}>
                <option value="all">{typeLabel("all")}</option>
                <option value="insatisfacao_hile">{typeLabel("insatisfacao_hile")}</option>
                <option value="insatisfacao_atendimento">{typeLabel("insatisfacao_atendimento")}</option>
              </select>
            </label>
            <label>
              Severidade
              <select value={severityFilter} onChange={(event) => { setSeverityFilter(event.target.value as AlertSeverityFilter); setPage(1); }}>
                <option value="all">Todas</option>
                <option value="critical">Crítico</option>
                <option value="high">Alto</option>
                <option value="medium">Médio</option>
              </select>
            </label>
          </div>
        </div>
      </article>

      <article className={`settings-card ${paged.length === 0 ? "data-dim" : ""}`} id="dissatisfaction-list">
        <div className="settings-card-head">Ocorrências</div>
        <div className="settings-card-body">
          {paged.length === 0 ? (
            <p className="empty-state">Sem ocorrências de insatisfação para os filtros aplicados.</p>
          ) : (
            <div className="report-list-animated">
              {paged.map((item) => {
                const alertType: AlertTypeFilter =
                  item.category === "insatisfacao_hile" ? "insatisfacao_hile" : "insatisfacao_atendimento";
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
                          {severityLabel(item.severity)}
                        </span>
                      </p>
                      <p><strong>Momento:</strong> {formatDateTime(item.occurredAt)}</p>
                      <p><strong>Evidência:</strong> {item.excerpt}</p>
                      <button type="button" className="link-btn link-btn-spaced" onClick={() => onOpenReportByContact(item.contactName)}>
                        Ver relatório desta pessoa
                      </button>
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
              <button type="button" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>
                {"<"}
              </button>
              <button type="button" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages}>
                {">"}
              </button>
            </div>
          ) : null}
        </div>
      </article>
    </section>
  );
}

