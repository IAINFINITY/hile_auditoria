import type { Severity } from "../../../types";
import { severityColors } from "../shared/constants";

export function DonutChart({
  snapshot,
  size = 180,
  centerLabel = "insights",
}: {
  snapshot: Record<Severity, number>;
  size?: number;
  centerLabel?: string;
}) {
  const total = Object.values(snapshot).reduce((acc, count) => acc + count, 0);

  if (total === 0) {
    return (
      <svg viewBox="0 0 120 120" width={size} height={size}>
        <circle cx="60" cy="60" r="44" fill="none" stroke="#dfe6ef" strokeWidth="10" />
        <text x="60" y="56" textAnchor="middle" fontSize="26" fontWeight="700" fill="#0b2740" fontFamily="'JetBrains Mono',monospace">0</text>
        <text x="60" y="70" textAnchor="middle" fontSize="10" fill="#6b8aa8" fontFamily="'Inter',sans-serif">{centerLabel}</text>
      </svg>
    );
  }

  const radius = 44;
  const cx = 60;
  const cy = 60;
  const circ = 2 * Math.PI * radius;
  let offset = 0;

  const circles = (Object.entries(snapshot) as Array<[Severity, number]>)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => {
      const len = (count / total) * circ;
      const node = (
        <circle
          key={`${severity}-${count}-${offset}`}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={severityColors[severity]}
          strokeWidth="10"
          strokeDasharray={`${len} ${circ}`}
          strokeDashoffset={-offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dashoffset 600ms" }}
        />
      );
      offset += len;
      return node;
    });

  return (
    <svg viewBox="0 0 120 120" width={size} height={size}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#dfe6ef" strokeWidth="10" />
      {circles}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="26" fontWeight="700" fill="#0b2740" fontFamily="'JetBrains Mono',monospace">{total}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="#6b8aa8" fontFamily="'Inter',sans-serif">{centerLabel}</text>
    </svg>
  );
}
