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
}

export function ScatterPlot({ points, size = 280, highlightId, extra }: Props) {
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
  const pad = 8;
  const inner = size - pad * 2;

  const cx = (x: number) =>
    Math.max(pad, Math.min(size - pad, pad + ((x - minX) / spanX) * inner));
  const cy = (y: number) =>
    Math.max(pad, Math.min(size - pad, size - pad - ((y - minY) / spanY) * inner));

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
      {points.map((p, i) => (
        <circle key={i} cx={cx(p.x)} cy={cy(p.y)} r={1.7} fill={p.color} fillOpacity={0.4}>
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
