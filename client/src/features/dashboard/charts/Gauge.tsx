export function Gauge({
  current,
  total,
  hasData = true,
}: {
  current: number;
  total: number;
  hasData?: boolean;
}) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  if (!hasData) {
    return (
      <div className="gauge-panel" id="targetGaugePanel">
        <div className="gauge-empty">Sem dados suficientes para calcular saúde do dia.</div>
      </div>
    );
  }

  return (
    <div className="gauge-panel" id="targetGaugePanel">
      <div className="gauge-header">
        <span id="gaugeRatio">{pct}%</span>
      </div>
      <div className="gauge-area">
        <div className="gauge-labels">
          <span>0%</span>
          <span id="gaugeMaxLabel">100%</span>
        </div>
        <div className="gauge-bar">
          <div className="gauge-fill" id="targetGaugeFill" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      </div>
    </div>
  );
}
