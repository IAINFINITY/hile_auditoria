import { useMemo } from "react";
import type { Severity } from "../../../types";
import { DonutChart } from "../charts/DonutChart";
import { GroupedHourlyChart } from "../charts/GroupedHourlyChart";
import { severityColors, severityLabel } from "../shared/constants";

interface MovementSectionProps {
  trendSeries: Array<{ label: string; value: number }>;
  severitySnapshot: Record<Severity, number>;
  totalMessagesDay: number;
  totalConversationsDay: number;
}

export function MovementSection({
  trendSeries,
  severitySnapshot,
  totalMessagesDay,
  totalConversationsDay,
}: MovementSectionProps) {
  const hasMovementData = trendSeries.length > 0;
  const total = trendSeries.reduce((sum, item) => sum + item.value, 0);
  const peak = trendSeries.reduce(
    (best, item) => (item.value > best.value ? item : best),
    { label: "--", value: 0 },
  );

  const gapTotal = useMemo(
    () => Object.values(severitySnapshot).reduce((acc, value) => acc + value, 0),
    [severitySnapshot],
  );

  const gapRows = useMemo(() => {
    const rows = (Object.entries(severitySnapshot) as Array<[Severity, number]>).map(([sev, count]) => {
      const pct = gapTotal > 0 ? (count / gapTotal) * 100 : 0;
      return { sev, count, pct };
    });
    return rows.sort((a, b) => b.count - a.count);
  }, [gapTotal, severitySnapshot]);

  const groupedData = useMemo(() => {
    const safeTotalConversations = totalConversationsDay > 0 ? totalConversationsDay : total || 1;
    const avgMessagesPerConversation = totalMessagesDay > 0 ? totalMessagesDay / safeTotalConversations : 5;

    return trendSeries.map((item) => {
      const volumeMessages = Math.max(0, Math.round(item.value * avgMessagesPerConversation));
      const ia = Math.round(volumeMessages * 0.58);
      const usuario = Math.max(0, volumeMessages - ia);
      return {
        label: item.label,
        conversas: item.value,
        ia,
        usuario,
      };
    });
  }, [totalConversationsDay, total, totalMessagesDay, trendSeries]);

  return (
    <div className="section reveal" id="movimentacao">
      <div className="section-inner">
        <div className="section-header">
          <span className="section-num">04</span>
          <div className="section-title">
            <h2>Movimentação</h2>
            <p>Volume por hora e distribuição dos gaps no período</p>
          </div>
        </div>

        <div className={`metrics-block ${hasMovementData ? "" : "data-dim"}`}>
          <div className="metrics-block-header">
            <span>Volume por hora</span>
            <span>Pico: {peak.label} ({peak.value}) • Total: {total}</span>
          </div>
          <div className="metrics-block-body">
            <div className="chart-legend">
              <span className="legend-item"><span className="legend-dot" style={{ background: "#106bb6" }} /> Conversas</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: "#45a3ff" }} /> Msg IA</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: "#0d3f73" }} /> Msg Usuário</span>
            </div>
            <GroupedHourlyChart data={groupedData} />
          </div>
        </div>

        <div className={`metrics-block ${gapTotal > 0 ? "" : "data-dim"}`}>
          <div className="metrics-block-header">
            <span>Pizza de gaps</span>
            <span>{gapTotal} ocorrência(s) distribuída(s) por severidade</span>
          </div>
          <div className="metrics-block-body movement-pie-wrap">
            <div>
              <div style={{ display: "grid", placeItems: "center" }}>
                <DonutChart snapshot={severitySnapshot} size={280} centerLabel="gaps" />
              </div>
            </div>
            <div className="severity-legend" id="donutLegend">
              {gapRows.map(({ sev, count, pct }) => (
                <div className="severity-legend-item" key={sev}>
                  <span className="severity-legend-dot" style={{ background: severityColors[sev] }} />
                  {severityLabel[sev]}
                  <span className="severity-legend-count">{count} • {pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
