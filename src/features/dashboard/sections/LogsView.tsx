import { useMemo } from "react";
import { FiCheckCircle, FiClock, FiXCircle } from "react-icons/fi";
import type { ReportHistoryItem, SystemCheckResponse } from "../../../types";

interface LogsViewProps {
  systemCheck: SystemCheckResponse | null;
  reportHistory: ReportHistoryItem[];
  currentStatus: string;
  isRunningOverview: boolean;
  currentRunId: string | null;
  runProgress: number;
  runCurrentContact: string | null;
  runTimeline: string[];
}

function fmtBr(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("pt-BR");
}

function durationSec(start: string, end: string | null): string {
  if (!end) return "em andamento";
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return "-";
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const seg = sec % 60;
  return `${min}m ${seg}s`;
}

export function LogsView({
  systemCheck,
  reportHistory,
  currentStatus,
  isRunningOverview,
  currentRunId,
  runProgress,
  runCurrentContact,
  runTimeline,
}: LogsViewProps) {
  const runsByDate = useMemo(() => {
    const map = new Map<string, ReportHistoryItem[]>();
    for (const run of reportHistory) {
      const key = String(run.date_ref || "");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(run);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [reportHistory]);

  const hasRecentRuns = runsByDate.length > 0;
  const dimExec = !isRunningOverview;
  const dimRecent = !hasRecentRuns;

  return (
    <div className="settings-shell">
      <div className="section-inner">
        <div className="section-header">
          <span className="section-num">01</span>
          <div className="section-title">
            <h2>Logs Operacionais</h2>
            <p>Registro de execuções, integrações e eventos do sistema.</p>
          </div>
        </div>
      </div>

      <article className="settings-card" id="logs-saude">
        <div className="settings-card-head">Saúde rápida</div>
        <div className="settings-card-body logs-grid">
          <p>
            <strong>Status Chatwoot:</strong> {systemCheck?.chatwoot?.ok ? "OK" : "Aguardando/Erro"}
          </p>
          <p>
            <strong>Status Dify:</strong> {systemCheck?.dify?.ok ? "OK" : "Aguardando/Erro"}
          </p>
          <p>
            <strong>Status geral:</strong> {currentStatus || "Sem execução no momento"}
          </p>
        </div>
      </article>

      <article className={`settings-card ${dimExec ? "data-dim" : ""}`} id="logs-execucao">
        <div className="settings-card-head">Execução em andamento</div>
        <div className="settings-card-body">
          {!isRunningOverview ? (
            <p className="empty-state">Nenhuma execução em andamento no momento.</p>
          ) : (
            <>
              <p><strong>Run:</strong> {currentRunId ? currentRunId : "em criação..."}</p>
              <p><strong>Contato atual:</strong> {runCurrentContact || "preparando execução..."}</p>
              <p><strong>Progresso:</strong> {runProgress}%</p>
              <div className="orq-progress-track" role="progressbar" aria-valuenow={runProgress} aria-valuemin={0} aria-valuemax={100}>
                <div className="orq-progress-fill" style={{ width: `${runProgress}%` }} />
              </div>
              <div className="logs-list" style={{ marginTop: 10 }}>
                {runTimeline.slice(-30).map((line, idx) => (
                  <article className="log-item" key={`line-${idx}`}>
                    <p>{line}</p>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </article>

      <article className={`settings-card ${dimRecent ? "data-dim" : ""}`} id="logs-recentes">
        <div className="settings-card-head">Execuções recentes</div>
        <div className="settings-card-body" style={{ gap: 0 }}>
          {runsByDate.length === 0 ? (
            <p className="empty-state">Nenhuma execução encontrada.</p>
          ) : (
            runsByDate.map(([dateLabel, runs]) => (
              <div key={dateLabel}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0 6px", borderBottom: "1px solid var(--line)", marginBottom: 6 }}>
                  <FiClock style={{ width: 14, height: 14, color: "var(--azul)", flexShrink: 0 }} />
                  <strong style={{ fontSize: "var(--fs-small)", color: "var(--navy)" }}>
                    {dateLabel || "Sem data"}
                  </strong>
                  <span style={{ fontSize: "var(--fs-tiny)", color: "var(--muted)" }}>
                    ({runs.length} execução{ runs.length !== 1 ? "ões" : "" })
                  </span>
                </div>
                <div className="logs-list" style={{ marginBottom: 10 }}>
                  {runs.map((run) => (
                    <article className="log-item" key={run.id} style={{ display: "grid", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {run.status === "completed" ? (
                          <FiCheckCircle style={{ width: 14, height: 14, color: "var(--low)", flexShrink: 0 }} />
                        ) : run.status === "failed" ? (
                          <FiXCircle style={{ width: 14, height: 14, color: "var(--critical)", flexShrink: 0 }} />
                        ) : (
                          <FiClock style={{ width: 14, height: 14, color: "var(--high)", flexShrink: 0 }} />
                        )}
                        <strong style={{ fontSize: "var(--fs-small)", color: "var(--navy)", textTransform: "capitalize" }}>
                          {run.status}
                        </strong>
                        <span style={{ fontSize: "var(--fs-tiny)", color: "var(--azul)", fontFamily: "var(--font-mono)" }}>
                          {run.id.slice(0, 8)}
                        </span>
                        {run.has_report && (
                          <span style={{ fontSize: "var(--fs-tiny)", color: "var(--low)", fontWeight: 600 }}>c/ relatório</span>
                        )}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px", fontSize: "var(--fs-tiny)", color: "var(--muted)" }}>
                        <span>Início: {fmtBr(run.started_at)}</span>
                        <span>Término: {fmtBr(run.finished_at)}</span>
                        <span>Duração: {durationSec(run.started_at, run.finished_at)}</span>
                        <span>Conversas: {run.processed}/{run.total_conversations}</span>
                        <span>Sucesso: {run.success_count}</span>
                        <span>Falhas: {run.failure_count}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </article>

    </div>
  );
}
