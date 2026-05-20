import { useEffect, useMemo, useState } from "react";
import type { DissatisfactionOverallResponse } from "../../../../types";
import { apiGet } from "@/lib/api";
import { toTitleCaseName } from "../../hooks/controller/common";
import type { OperationalAlertItem } from "../../shared/types";

interface DissatisfactionOverallViewProps {
  onOpenReportByContact: (contactName: string) => void;
  refreshHint?: string | null;
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

export function DissatisfactionOverallView({
  onOpenReportByContact,
  refreshHint,
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

  return (
    <section className="accounts-shell dissatisfaction-shell">
      <div className="section-inner reveal" id="dissatisfaction-overview">
        <div className="section-header">
          <span className="section-num">{headerNumber}</span>
          <div className="section-title">
            <h2>Registro de Insatisfação (Geral)</h2>
            <p>
              Consolidado de todas as execuções salvas
              {payload?.date_range?.from && payload?.date_range?.to
                ? ` (${payload.date_range.from} até ${payload.date_range.to})`
                : "."}
            </p>
          </div>
        </div>
      </div>

      <article className={`settings-card ${summary.total === 0 ? "data-dim" : ""}`}>
        <div className="settings-card-head">Panorama geral</div>
        <div className="settings-card-body dissatisfaction-kpis">
          <p><strong>Ocorrências:</strong> {summary.total}</p>
          <p><strong>Clientes impactados:</strong> {summary.unique_contacts}</p>
          <p><strong>Críticos:</strong> {summary.critical}</p>
          <p><strong>Altos:</strong> {summary.high}</p>
          <p><strong>Médios:</strong> {summary.medium}</p>
          <p><strong>Execuções:</strong> {payload?.total_runs || 0}</p>
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
          {loading ? <p className="empty-state">Carregando insatisfação geral...</p> : null}
          {!loading && error ? <p className="empty-state">{error}</p> : null}
          {!loading && !error && paged.length === 0 ? (
            <p className="empty-state">Sem ocorrências de insatisfação para os filtros aplicados.</p>
          ) : null}

          {!loading && !error && paged.length > 0 ? (
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
                        <strong>{toTitleCaseName(item.contactName || "")}</strong> ⬢ conversa #{item.conversationId || "-"}
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
          ) : null}

          {filteredAlerts.length > perPage ? (
            <div className="pagination-row">
              <span>
                {filteredAlerts.length} registros ⬢ Página {safePage} de {totalPages}
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

