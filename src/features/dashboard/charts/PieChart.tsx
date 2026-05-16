export function PieChart({ data }: { data: Array<{ label: string; value: number }> }) {
  const filtered = data.filter((item) => item.value > 0);
  const total = filtered.reduce((sum, item) => sum + item.value, 0);

  if (!total) {
    return (
      <div className="empty-state" style={{ margin: 0 }}>
        Rode o overview para carregar a distribuição por horário.
      </div>
    );
  }

  const radius = 54;
  const cx = 70;
  const cy = 70;
  const circ = 2 * Math.PI * radius;
  const palette = ["#0c63a8", "#39a0ed", "#8ecae6", "#2a9d8f", "#457b9d", "#264653"];

  const arcs = filtered.map((item, idx) => {
    const len = (item.value / total) * circ;
    const priorLen = filtered
      .slice(0, idx)
      .reduce((acc, prev) => acc + (prev.value / total) * circ, 0);
    return {
      key: `${item.label}-${item.value}-${idx}`,
      len,
      offset: -priorLen,
      stroke: palette[idx % palette.length],
      label: item.label,
      value: item.value,
    };
  });

  return (
    <div style={{ display: "grid", gap: "0.75rem", alignItems: "center" }}>
      <svg viewBox="0 0 140 140" width="210" height="210" style={{ display: "block", margin: "0 auto" }}>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#dfe6ef" strokeWidth="18" />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={arc.stroke}
            strokeWidth="18"
            strokeDasharray={`${arc.len} ${circ}`}
            strokeDashoffset={arc.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill="#0b2740" fontFamily="'JetBrains Mono',monospace">
          {total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="#6b8aa8" fontFamily="'Inter',sans-serif">
          conversas
        </text>
      </svg>

      <div className="severity-legend">
        {arcs.map((arc) => (
          <div className="severity-legend-item" key={`legend-${arc.key}`}>
            <span className="severity-legend-dot" style={{ background: arc.stroke }} />
            {arc.label}
            <span className="severity-legend-count">{arc.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
