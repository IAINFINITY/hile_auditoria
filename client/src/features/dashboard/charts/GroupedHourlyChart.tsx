export interface GroupedHourPoint {
  label: string;
  conversas: number;
  ia: number;
  usuario: number;
}

function ceilToStep(value: number, step: number): number {
  if (value <= 0) return step;
  return Math.ceil(value / step) * step;
}

export function GroupedHourlyChart({ data }: { data: GroupedHourPoint[] }) {
  if (!data.length) {
    return (
      <div className="empty-state" style={{ margin: 0 }}>
        Rode o overview para carregar a movimentação por hora.
      </div>
    );
  }

  const maxRaw = Math.max(...data.map((d) => Math.max(d.conversas, d.ia, d.usuario)));
  const tickCount = 5;
  const yMax = ceilToStep(maxRaw, Math.max(5, Math.ceil(maxRaw / tickCount)));

  const margin = { top: 16, right: 22, bottom: 42, left: 56 };
  const chartH = 360;
  const plotH = chartH - margin.top - margin.bottom;

  const barW = 12;
  const seriesGap = 4;
  const groupW = barW * 3 + seriesGap * 2;
  const groupGap = 18;
  const plotW = data.length * groupW + Math.max(0, data.length - 1) * groupGap;
  const chartW = Math.max(1040, margin.left + margin.right + plotW + 24);

  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = Math.round((yMax / tickCount) * index);
    const y = margin.top + plotH - (value / yMax) * plotH;
    return { value, y };
  });

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${chartW} ${chartH}`} width="100%" height={chartH}>
        <text
          x={margin.left + plotW / 2}
          y={chartH - 8}
          textAnchor="middle"
          fontSize="12"
          fill="#4d6484"
          fontFamily="'Inter',sans-serif"
        >
          Horas do dia
        </text>
        <text
          x={16}
          y={margin.top + plotH / 2}
          textAnchor="middle"
          fontSize="12"
          fill="#4d6484"
          fontFamily="'Inter',sans-serif"
          transform={`rotate(-90 16 ${margin.top + plotH / 2})`}
        >
          Volume
        </text>
        <line x1={margin.left} y1={margin.top + plotH} x2={margin.left + plotW} y2={margin.top + plotH} stroke="#8798b2" strokeWidth="1.4" />
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotH} stroke="#8798b2" strokeWidth="1.4" />

        {ticks.map((tick) => (
          <g key={`tick-${tick.value}`}>
            <line
              x1={margin.left}
              y1={tick.y}
              x2={margin.left + plotW}
              y2={tick.y}
              stroke="#d3deec"
              strokeWidth="1"
            />
            <text
              x={margin.left - 10}
              y={tick.y + 4}
              textAnchor="end"
              fontSize="12"
              fill="#5a6f90"
              fontFamily="'Inter',sans-serif"
            >
              {tick.value}
            </text>
          </g>
        ))}

        {data.map((point, index) => {
          const startX = margin.left + index * (groupW + groupGap);
          const bars = [
            { key: "conversas", value: point.conversas, color: "var(--accent)" },
            { key: "ia", value: point.ia, color: "#0f1d3d" },
            { key: "usuario", value: point.usuario, color: "var(--muted)" },
          ];

          return (
            <g key={point.label}>
              {bars.map((bar, i) => {
                const height = yMax > 0 ? (bar.value / yMax) * plotH : 0;
                const x = startX + i * (barW + seriesGap);
                const y = margin.top + plotH - height;
                return (
                  <g key={`${point.label}-${bar.key}`}>
                    <rect x={x} y={y} width={barW} height={Math.max(2, height)} fill={bar.color} rx={0} />
                    <text
                      x={x + barW / 2}
                      y={y - 6}
                      textAnchor="middle"
                      fontSize="9"
                      fill="var(--text-muted)"
                      fontFamily="'JetBrains Mono',monospace"
                    >
                      {bar.value}
                    </text>
                  </g>
                );
              })}
              <text
                x={startX + groupW / 2}
                y={margin.top + plotH + 24}
                textAnchor="middle"
                fontSize="12"
                fill="#5a6f90"
                fontFamily="'Inter',sans-serif"
              >
                {point.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
