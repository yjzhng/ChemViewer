/**
 * Dot radius + opacity scaled to the point count: larger, more opaque dots for
 * small samples; smaller, more transparent for big ones (so dense maps stay
 * readable). Log-interpolated between the two clamps.
 */
export function scaleDot(n: number): { r: number; opacity: number } {
  const lo = 40;
  const hi = 4000;
  const t = Math.min(
    1,
    Math.max(0, (Math.log(Math.max(n, 1)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))),
  );
  return {
    r: 3.4 - t * (3.4 - 1.1), // 3.4 (few) → 1.1 (many)
    opacity: 0.9 - t * (0.9 - 0.28), // 0.9 (few) → 0.28 (many)
  };
}

/** Minimal normalized SVG scatter plot. */
export interface ScatterPoint {
  x: number;
  y: number;
  color: string;
  /** Identifier used for hover-highlighting + tooltip. */
  id?: string;
}

interface Props {
  points: ScatterPoint[];
  size?: number;
  /** Highlight the point with this id (drawn last, in accent). */
  highlightId?: string;
  /** Out-of-sample point (MDS coords) to mark in accent (e.g. a hovered row). */
  extra?: { x: number; y: number } | null;
  /** Grey axis captions along the bottom (x) and left (y) edges. */
  xLabel?: string;
  yLabel?: string;
}

export function ScatterPlot({
  points,
  size = 280,
  highlightId,
  extra,
  xLabel,
  yLabel,
}: Props) {
  if (points.length === 0) {
    return <div className="muted">No points.</div>;
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  // Extra padding on the labelled edges (left for y-axis, bottom for x-axis)
  // so points don't sit on top of the axis captions.
  const padL = yLabel ? 20 : 8;
  const padB = xLabel ? 20 : 8;
  const padT = 8;
  const padR = 8;
  const innerW = size - padL - padR;
  const innerH = size - padT - padB;

  const cx = (x: number) =>
    Math.max(padL, Math.min(size - padR, padL + ((x - minX) / spanX) * innerW));
  const cy = (y: number) =>
    Math.max(padT, Math.min(size - padB, size - padB - ((y - minY) / spanY) * innerH));

  const dot = scaleDot(points.length);

  const hitPoint =
    highlightId != null ? points.find((p) => p.id === highlightId) : undefined;
  const mark = hitPoint
    ? { x: cx(hitPoint.x), y: cy(hitPoint.y) }
    : extra
      ? { x: cx(extra.x), y: cy(extra.y) }
      : null;

  return (
    <svg
      className="scatter"
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={0} y={0} width={size} height={size} fill="var(--bg)" rx={6} />
      {xLabel && (
        <text x={size / 2} y={size - 4} fontSize={9} fill="var(--muted)" textAnchor="middle">
          {xLabel}
        </text>
      )}
      {yLabel && (
        <text
          x={11}
          y={size / 2}
          fontSize={9}
          fill="var(--muted)"
          textAnchor="middle"
          transform={`rotate(-90 11 ${size / 2})`}
        >
          {yLabel}
        </text>
      )}
      {points.map((p, i) => (
        <circle key={i} cx={cx(p.x)} cy={cy(p.y)} r={dot.r} fill={p.color} fillOpacity={dot.opacity}>
          {p.id && <title>{p.id}</title>}
        </circle>
      ))}
      {mark && (
        <circle
          cx={mark.x}
          cy={mark.y}
          r={5}
          fill="var(--accent)"
          stroke="var(--bg)"
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
}

/** Distinct-ish categorical palette for clusters / sets. */
export function categoryColor(i: number): string {
  const palette = [
    '#4f9cf9',
    '#e5894b',
    '#5fd07f',
    '#e5534b',
    '#b07ff0',
    '#41c5c5',
    '#e0c14a',
    '#e57fb0',
    '#7f9cf0',
    '#8fd04a',
  ];
  return palette[i % palette.length];
}
