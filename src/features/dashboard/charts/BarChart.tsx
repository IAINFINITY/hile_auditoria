export function BarChart({ data }: { data: Array<{ label: string; value: number }> }) {
  if (!data.length) {
    return (
      <div className="empty-state" style={{ margin: 0 }}>
        Rode o overview para carregar a tendência por hora.
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value));
  const w = Math.max(data.length * 44 + 60, 560);
  const h = 300;
  const barW = 26;
  const gap = 18;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ display: "block" }}>
      {data.map((d, i) => {
        const bh = max > 0 ? (d.value / max) * (h - 68) : 0;
        const x = i * (barW + gap) + 24;
        const y = h - 34 - bh;

        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={Math.max(bh, 2)} fill="var(--accent)" opacity={0.92} rx={2} />
            <text x={x + barW / 2} y={h - 10} textAnchor="middle" fontSize="10" fill="var(--text-muted)" fontFamily="'Inter',sans-serif">{d.label}</text>
            <text x={x + barW / 2} y={y - 7} textAnchor="middle" fontSize="10" fill="var(--text-heading)" fontFamily="'JetBrains Mono',monospace" fontWeight={600}>{d.value}</text>
          </g>
        );
      })}
    </svg>
  );
}
