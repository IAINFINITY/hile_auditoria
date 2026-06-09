import { useMemo, useState } from "react";
import { FiCheckCircle, FiClock, FiXCircle } from "react-icons/fi";
import type { ReportHistoryItem, SystemCheckResponse } from "../../../../types";
import { HileCardGrid, HileEmptyPanel, HileInlineInsight, HileKpiCard, HileSectionShell, HileSurfaceCard } from "../../shared/ui/HilePrimitives";

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

function durationSecondsValue(start: string, end: string | null): number | null {
  if (!end) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  return Math.max(0, Math.round((e - s) / 1000));
}

function riskLabel(value: "critical" | "non_critical" | null | undefined): string {
  return value === "critical" ? "Crítico" : "Não crítico";
}

function reportDateLabel(run: ReportHistoryItem): string {
  const reportDate = String(run.report_date || "").trim();
  if (reportDate) return reportDate;
  const reportJsonDate = String(run.report_json?.date || "").trim();
  if (reportJsonDate) return reportJsonDate;
  return String(run.date_ref || "").trim() || "-";
}

function triggerSourceLabel(value: ReportHistoryItem["trigger_source"]): string {
  if (value === "auto_sync") return "Automática";
  if (value === "manual") return "Manual";
  return "Não identificada";
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
  const [downloadingRunId, setDownloadingRunId] = useState<string | null>(null);

  async function handleDownloadRunTxt(runId: string, dateRef: string) {
    if (!runId || downloadingRunId) return;
    setDownloadingRunId(runId);
    try {
      const query = new URLSearchParams();
      query.set("run_id", runId);
      const response = await fetch(`/api/report-day/export-txt?${query.toString()}`, {
        method: "GET",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Não foi possível baixar o relatório em TXT.");
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `relatorio-${dateRef}-${runId.slice(0, 8)}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Falha ao baixar relatório em TXT.";
      alert(message);
    } finally {
      setDownloadingRunId((current) => (current === runId ? null : current));
    }
  }

  return (
    <section className="settings-shell reveal">
      <div className="section-inner">
        <HileSectionShell
          eyebrow="01"
          title="Logs Operacionais"
          description="Registro de execuções, integrações e eventos do sistema em uma linha do tempo consolidada."
        >
          <div className="hile-section-stack">
            <HileCardGrid cols={3}>
              <HileKpiCard
                label="Chatwoot"
                value={systemCheck?.chatwoot?.ok ? "OK" : "Aguardando"}
                hint="Saúde da integração"
                tone={systemCheck?.chatwoot?.ok ? "success" : "default"}
                accent={systemCheck?.chatwoot?.ok ? "success" : "default"}
              />
              <HileKpiCard
                label="Dify"
                value={systemCheck?.dify?.ok ? "OK" : "Aguardando"}
                hint="Status do motor de análise"
                tone={systemCheck?.dify?.ok ? "success" : "default"}
                accent={systemCheck?.dify?.ok ? "success" : "default"}
              />
              <HileKpiCard
                label="Execuções recentes"
                value={reportHistory.length}
                hint={currentStatus || "Sem execução no momento"}
                tone={reportHistory.length > 0 ? "accent" : "default"}
                accent="accent"
              />
            </HileCardGrid>

            <HileSurfaceCard title="Saúde rápida" description="Leitura resumida dos pontos mais sensíveis do ambiente." tone="soft">
              <div className="hile-section-stack">
                <HileInlineInsight title="Status geral">{currentStatus || "Sem execução no momento"}</HileInlineInsight>
                {!systemCheck?.chatwoot?.ok ? (
                  <HileInlineInsight title="Atenção no Chatwoot" tone="warning">
                    A integração não retornou como saudável na última checagem.
                  </HileInlineInsight>
                ) : null}
                {!systemCheck?.dify?.ok ? (
                  <HileInlineInsight title="Atenção no Dify" tone="warning">
                    O motor de análise ainda não respondeu como esperado na última verificação.
                  </HileInlineInsight>
                ) : null}
              </div>
            </HileSurfaceCard>

            <HileSurfaceCard
              title="Execução em andamento"
              description="Acompanhamento em tempo real da orquestração atual."
              tone={isRunningOverview ? "accent" : "soft"}
            >
              {!isRunningOverview ? (
                <HileEmptyPanel title="Nenhuma execução em andamento" description="Quando uma nova rodada iniciar, o progresso e os logs aparecerão aqui." />
              ) : (
                <div className="hile-section-stack">
                  <HileCardGrid cols={3}>
                    <HileKpiCard label="Run" value={currentRunId ? currentRunId.slice(0, 8) : "criando"} hint={currentRunId || "Em criação"} accent="accent" />
                    <HileKpiCard label="Contato atual" value={runCurrentContact || "preparando"} hint="Item em processamento" />
                    <HileKpiCard label="Progresso" value={`${runProgress}%`} hint="Percentual concluído" tone="accent" accent="accent" />
                  </HileCardGrid>
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
                </div>
              )}
            </HileSurfaceCard>

            <HileSurfaceCard title="Execuções recentes" description="Histórico agrupado por data de referência do relatório." tone={hasRecentRuns ? "default" : "soft"}>
              {!hasRecentRuns ? (
                <HileEmptyPanel title="Nenhuma execução encontrada" description="Assim que houver rodadas salvas, elas serão listadas nesta área." />
              ) : (
                <div className="hile-section-stack">
                  {runsByDate.map(([dateLabel, runs]) => (
                    <div key={dateLabel}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 0 10px", borderBottom: "1px solid var(--line)", marginBottom: 10 }}>
                        <FiClock style={{ width: 14, height: 14, color: "var(--azul)", flexShrink: 0 }} />
                        <strong style={{ fontSize: "var(--fs-small)", color: "var(--navy)" }}>{dateLabel || "Sem data"}</strong>
                        <span style={{ fontSize: "var(--fs-tiny)", color: "var(--muted)" }}>
                          ({runs.length} execução{runs.length !== 1 ? "ões" : ""})
                        </span>
                      </div>

                      <div className="logs-list" style={{ marginBottom: 10 }}>
                        {runs.map((run) => (
                          <article className="log-item" key={run.id} style={{ display: "grid", gap: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              {run.status === "completed" ? (
                                <FiCheckCircle style={{ width: 14, height: 14, color: "var(--low)", flexShrink: 0 }} />
                              ) : run.status === "failed" ? (
                                <FiXCircle style={{ width: 14, height: 14, color: "var(--critical)", flexShrink: 0 }} />
                              ) : (
                                <FiClock style={{ width: 14, height: 14, color: "var(--high)", flexShrink: 0 }} />
                              )}
                              <strong style={{ fontSize: "var(--fs-small)", color: "var(--navy)", textTransform: "capitalize" }}>{run.status}</strong>
                              <span style={{ fontSize: "var(--fs-tiny)", color: "var(--azul)", fontFamily: "var(--font-mono)" }}>{run.id.slice(0, 8)}</span>
                              {run.has_report ? <span style={{ fontSize: "var(--fs-tiny)", color: "var(--low)", fontWeight: 600 }}>c/ relatório</span> : null}
                              {run.has_report && run.status === "completed" ? (
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  onClick={() => void handleDownloadRunTxt(run.id, run.date_ref)}
                                  disabled={downloadingRunId === run.id}
                                >
                                  {downloadingRunId === run.id ? "Baixando..." : "Baixar relatório TXT"}
                                </button>
                              ) : null}
                            </div>

                            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: "var(--fs-tiny)", color: "var(--muted)" }}>
                              <span><strong>Executado em:</strong> {fmtBr(run.started_at)}</span>
                              <span><strong>Relatório para:</strong> {reportDateLabel(run)}</span>
                              <span><strong>Origem:</strong> {triggerSourceLabel(run.trigger_source)}</span>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px 16px", fontSize: "var(--fs-tiny)", color: "var(--muted)" }}>
                              <span>Solicitado para: {run.requested_date || reportDateLabel(run)}</span>
                              <span>Solicitado em: {fmtBr(run.requested_at || null)}</span>
                              <span>Início: {fmtBr(run.started_at)}</span>
                              <span>Término: {fmtBr(run.finished_at)}</span>
                              <span>Duração: {durationSec(run.started_at, run.finished_at)}</span>
                              <span>
                                Média por contato:{" "}
                                {(() => {
                                  const seconds = durationSecondsValue(run.started_at, run.finished_at);
                                  if (seconds === null || run.processed <= 0) return "-";
                                  return `${Math.max(1, Math.round(seconds / run.processed))}s`;
                                })()}
                              </span>
                              <span>Conversas: {run.processed}/{run.total_conversations}</span>
                              <span>Sucesso: {run.success_count}</span>
                              <span>Falhas: {run.failure_count}</span>
                            </div>

                            {(run.report_json?.logs?.length || 0) > 0 ? (
                              <div style={{ marginTop: 4, borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
                                <p style={{ margin: 0, fontSize: "var(--fs-tiny)", color: "var(--muted)" }}>
                                  Contatos desta execução ({run.report_json?.logs?.length})
                                </p>
                                <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                                  {run.report_json!.logs!.slice(0, 8).map((log) => (
                                    <div
                                      key={`${run.id}-${log.contact_key}`}
                                      style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "6px 8px", display: "grid", gap: 3 }}
                                    >
                                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                        <strong style={{ color: "var(--navy)" }}>{log.contact_name || log.contact_key}</strong>
                                        <span style={{ fontSize: "var(--fs-tiny)", color: log.risk_level === "critical" ? "var(--critical)" : "var(--azul-line)" }}>
                                          {riskLabel(log.risk_level)}
                                        </span>
                                        <span style={{ fontSize: "var(--fs-tiny)", color: "var(--muted)" }}>{log.finalization_status || "sem status final"}</span>
                                      </div>
                                      <p style={{ margin: 0, fontSize: "var(--fs-tiny)", color: "var(--muted)" }}>
                                        Conversas: {log.conversation_ids?.length || 0} • Links: {log.chatwoot_links?.length || 0}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </HileSurfaceCard>
          </div>
        </HileSectionShell>
      </div>
    </section>
  );
}
