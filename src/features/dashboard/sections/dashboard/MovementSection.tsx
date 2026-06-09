import { useMemo } from "react";
import type { Severity } from "../../../../types";
import { DonutChart } from "../../charts/DonutChart";
import { GroupedHourlyChart } from "../../charts/GroupedHourlyChart";
import { severityColors, severityLabel } from "../../shared/constants";
import { HileEmptyPanel, HileSectionShell, HileSurfaceCard } from "../../shared/ui/HilePrimitives";

const PIE_SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

interface MovementSectionProps {
  trendSeries: Array<{ label: string; conversas: number; ia: number; usuario: number }>;
  severitySnapshot: Record<Severity, number>;
  totalMessagesDay: number;
  totalConversationsDay: number;
  sectionId?: string;
  sectionNumber?: string;
}

export function MovementSection({
  trendSeries,
  severitySnapshot,
  totalMessagesDay,
  totalConversationsDay,
  sectionId = "movimentacao",
  sectionNumber = "04",
}: MovementSectionProps) {
  const hasMovementData = trendSeries.length > 0;
  const total = trendSeries.reduce((sum, item) => sum + item.conversas, 0);
  const peak = trendSeries.reduce(
    (best, item) => (item.conversas > best.value ? { label: item.label, value: item.conversas } : best),
    { label: "--", value: 0 } as { label: string; value: number },
  );

  const pieSnapshot = useMemo(
    () => ({
      critical: severitySnapshot.critical || 0,
      high: severitySnapshot.high || 0,
      medium: severitySnapshot.medium || 0,
      low: severitySnapshot.low || 0,
      info: 0,
    }),
    [severitySnapshot.critical, severitySnapshot.high, severitySnapshot.medium, severitySnapshot.low],
  );

  const gapTotal = useMemo(
    () => PIE_SEVERITIES.reduce((acc, severity) => acc + (severitySnapshot[severity] || 0), 0),
    [severitySnapshot],
  );

  const gapRows = useMemo(
    () =>
      PIE_SEVERITIES.map((sev) => {
        const count = severitySnapshot[sev] || 0;
        const pct = gapTotal > 0 ? (count / gapTotal) * 100 : 0;
        return { sev, count, pct };
      }),
    [gapTotal, severitySnapshot],
  );

  const groupedData = useMemo(() => trendSeries, [trendSeries]);

  return (
    <div className="section reveal" id={sectionId}>
      <div className="section-inner">
        <HileSectionShell
          eyebrow={sectionNumber}
          title="Movimentação"
          description="Volume por hora e distribuição dos gaps no período analisado."
        >
          <div className="hile-section-stack">
            <HileSurfaceCard
              title="Volume por hora"
              description={`Pico: ${peak.label} (${peak.value}) • Conversas: ${totalConversationsDay || total} • Mensagens: ${totalMessagesDay}`}
              className={hasMovementData ? "" : "data-dim"}
            >
              {hasMovementData ? (
                <>
                  <div className="chart-legend">
                    <span className="legend-item">
                      <span className="legend-dot" style={{ background: "var(--azul)" }} /> Conversas
                    </span>
                    <span className="legend-item">
                      <span className="legend-dot" style={{ background: "var(--navy)" }} /> Mensagens IA
                    </span>
                    <span className="legend-item">
                      <span className="legend-dot" style={{ background: "var(--muted)" }} /> Mensagens Usuário
                    </span>
                  </div>
                  <GroupedHourlyChart data={groupedData} />
                </>
              ) : (
                <HileEmptyPanel
                  title="Rode o overview para carregar a movimentação por hora."
                  description="Assim que houver dados no consolidado, o gráfico aparece aqui."
                />
              )}
            </HileSurfaceCard>

            <HileSurfaceCard
              title="Distribuição de gaps"
              description={`${gapTotal} ocorrência(s) distribuída(s) por severidade.`}
              className={gapTotal > 0 ? "" : "data-dim"}
            >
              {gapTotal > 0 ? (
                <div className="movement-pie-wrap">
                  <div>
                    <div style={{ display: "grid", placeItems: "center" }}>
                      <DonutChart snapshot={pieSnapshot} size={280} centerLabel="gaps" />
                    </div>
                  </div>
                  <div className="severity-legend" id="donutLegend">
                    {gapRows.map(({ sev, count, pct }) => (
                      <div className="severity-legend-item" key={sev}>
                        <span className="severity-legend-dot" style={{ background: severityColors[sev] }} />
                        {severityLabel[sev]}
                        <span className="severity-legend-count">
                          {count} • {pct.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <HileEmptyPanel
                  title="Ainda não há gaps distribuídos por severidade."
                  description="Quando o overview consolidar ocorrências, a distribuição visual aparece aqui."
                />
              )}
            </HileSurfaceCard>
          </div>
        </HileSectionShell>
      </div>
    </div>
  );
}
