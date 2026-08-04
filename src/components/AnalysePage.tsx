import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../data/store';
import { useResizablePanel } from '../useResizablePanel';
import {
  loadResult,
  persistResult,
  resolveAnalyses,
  blankAnalyses,
  ANALYSIS_TYPES,
  ANALYSIS_GROUPS,
  RADAR_AXES,
  RING_COLS,
  AUTO_SAMPLE,
  DB_ALL_CAP,
  comparisonSig,
  type Comparison,
  type CmpResult,
  type CmpGroup,
  type CmpSource,
  type PropOverlay,
  type SmartsRates,
} from '../data/comparisons';
import { ScatterPlot, scaleDot, categoryColor, type ScatterPoint } from './ScatterPlot';

const PALETTE = Array.from({ length: 10 }, (_, i) => categoryColor(i));

/** Small pencil icon for the "rename" affordance. */
function PencilIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

interface AvailSource {
  sourceId: string;
  label: string;
  libName: string;
  kind: 'library' | 'subset';
  backend: 'memory' | 'duckdb';
  subsetId?: string;
}

function useAvailableSources(): AvailSource[] {
  const manifest = useStore((s) => s.manifest);
  const extras = useStore((s) => s.extras);
  const subsets = useStore((s) => s.subsets);
  return useMemo(() => {
    const out: AvailSource[] = [];
    const seen = new Set<string>();
    for (const m of manifest) {
      out.push({ sourceId: `lib:${m.name}`, label: m.name, libName: m.name, kind: 'library', backend: m.backend });
      seen.add(m.name);
    }
    for (const name of Object.keys(extras)) {
      if (seen.has(name)) continue;
      out.push({ sourceId: `lib:${name}`, label: name, libName: name, kind: 'library', backend: 'memory' });
      seen.add(name);
    }
    for (const sub of subsets) {
      out.push({
        sourceId: `sub:${sub.id}`,
        label: `${sub.libraryId} › ${sub.name}`,
        libName: sub.libraryId,
        kind: 'subset',
        backend: 'memory',
        subsetId: sub.id,
      });
    }
    return out;
  }, [manifest, extras, subsets]);
}

function StatusDot({ status }: { status: Comparison['status'] }) {
  const cls =
    status === 'ready'
      ? 'on'
      : status === 'running'
        ? 'run'
        : status === 'error'
          ? 'err'
          : '';
  return <span className={`ready-dot ${cls}`} />;
}

// ---- result plots ----------------------------------------------------------

const fmtNum = (n: number) =>
  Math.abs(n) >= 100000 || (n !== 0 && Math.abs(n) < 0.01)
    ? n.toExponential(1)
    : String(Number(n.toFixed(2)));

const pct = (n: number) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : '–');

function PropChart({ p, groups }: { p: PropOverlay; groups: CmpGroup[] }) {
  const nb = p.bins.find((b) => b.length)?.length ?? 0;
  return (
    <div className="prop-chart">
      <div className="prop-head">
        <span>{p.key}</span>
        <span className="muted">
          {fmtNum(p.min)} – {fmtNum(p.max)}
        </span>
      </div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="prop-svg">
        {p.bins.map((b, gi) =>
          b.length ? (
            <polyline
              key={gi}
              fill="none"
              stroke={groups[gi].color}
              strokeWidth={1.3}
              opacity={0.85}
              vectorEffect="non-scaling-stroke"
              points={b.map((h, i) => `${(i / (nb - 1)) * 100},${40 - h * 37}`).join(' ')}
            />
          ) : null,
        )}
      </svg>
    </div>
  );
}

const PSIZE = 240;
const PPAD = 20;
const PINNER = PSIZE - PPAD * 2;
const ppx = (n1: number) => PPAD + Math.max(0, Math.min(1, n1)) * PINNER;
const ppy = (n2: number) =>
  PPAD + (1 - Math.max(0, Math.min(1, (n2 - 0.5) / 0.5))) * PINNER;

function PmiOverlayPlot({ points }: { points: CmpResult['pmi'] }) {
  if (!points) return null;
  const dot = scaleDot(points.points.length);
  return (
    <svg className="scatter" viewBox={`0 0 ${PSIZE} ${PSIZE}`} width="100%" preserveAspectRatio="xMidYMid meet">
      <rect x={0} y={0} width={PSIZE} height={PSIZE} fill="var(--bg)" rx={6} />
      <polygon
        points={`${ppx(0)},${ppy(1)} ${ppx(1)},${ppy(1)} ${ppx(0.5)},${ppy(0.5)}`}
        fill="none"
        stroke="var(--border)"
        strokeWidth={1}
      />
      <text x={ppx(0)} y={ppy(1) - 5} fontSize={9} fill="var(--muted)">rod</text>
      <text x={ppx(1)} y={ppy(1) - 5} fontSize={9} fill="var(--muted)" textAnchor="end">sphere</text>
      <text x={ppx(0.5)} y={ppy(0.5) + 11} fontSize={9} fill="var(--muted)" textAnchor="middle">disc</text>
      {points.points.map((p, i) => (
        <circle key={i} cx={ppx(p.npr1)} cy={ppy(p.npr2)} r={dot.r} fill={p.color} fillOpacity={dot.opacity} />
      ))}
    </svg>
  );
}

const heat = (v: number) =>
  Number.isFinite(v)
    ? `color-mix(in srgb, var(--accent) ${Math.round(v * 70)}%, transparent)`
    : 'transparent';

/** Table of SMARTS-panel hit rates: rows = patterns, columns = sets. */
function RatesCard({
  title,
  hint,
  data,
  anyRate,
}: {
  title: string;
  hint: string;
  data: SmartsRates;
  anyRate?: number[];
}) {
  return (
    <div className="analyse-card">
      <h3>{title}</h3>
      <p className="muted small">{hint}</p>
      <table className="sim-matrix rates-table">
        <thead>
          <tr>
            <th className="rowhead" />
            {data.setColors.map((c, i) => (
              <th key={i} title={data.setLabels[i]}>
                <span className="swatch" style={{ background: c }} />
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {anyRate && (
            <tr>
              <th className="rowhead">Any alert</th>
              {anyRate.map((v, i) => (
                <td key={i} className="diag" style={{ background: heat(v) }}>
                  {pct(v)}
                </td>
              ))}
            </tr>
          )}
          {data.rows.map((r, ri) => (
            <tr key={ri}>
              <th className="rowhead">{r.label}</th>
              {r.fractions.map((v, i) => (
                <td key={i} style={{ background: heat(v) }}>
                  {pct(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixCard({
  title,
  hint,
  groups,
  matrix,
  format,
}: {
  title: string;
  hint: string;
  groups: CmpGroup[];
  matrix: number[][];
  format: (v: number) => string;
}) {
  return (
    <div className="analyse-card">
      <h3>{title}</h3>
      <p className="muted small">{hint}</p>
      <table className="sim-matrix">
        <thead>
          <tr>
            <th />
            {groups.map((g, i) => (
              <th key={g.label} title={g.label}>
                <span className="swatch" style={{ background: g.color }} />
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, r) => (
            <tr key={r}>
              <th className="rowhead">
                <span className="swatch" style={{ background: groups[r].color }} />
                {groups[r].label}
              </th>
              {row.map((v, c) => (
                <td
                  key={c}
                  className={r === c ? 'diag' : ''}
                  style={{
                    background: Number.isFinite(v)
                      ? `color-mix(in srgb, var(--accent) ${Math.round(v * 70)}%, transparent)`
                      : 'transparent',
                  }}
                >
                  {Number.isFinite(v) ? format(v) : '–'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rule-of-5 radar: mean MW/cLogP/HBD/HBA per set vs the Ro5 limits. */
function RadarChart({ sets }: { sets: NonNullable<CmpResult['radar']> }) {
  const SIZE = 240;
  const cx = SIZE / 2;
  const cy = SIZE / 2 + 4;
  const R = 82;
  const DISP = 1; // the Ro5/Veber limit is the outermost hexagon
  const n = RADAR_AXES.length;
  const ang = (i: number) => -Math.PI / 2 + (i / n) * 2 * Math.PI;
  const at = (i: number, r: number): [number, number] => [
    cx + Math.cos(ang(i)) * r,
    cy + Math.sin(ang(i)) * r,
  ];
  const ringPts = (norm: number) =>
    RADAR_AXES.map((_, i) => at(i, (norm / DISP) * R).join(',')).join(' ');
  const setPts = (means: number[]) =>
    RADAR_AXES.map((ax, i) => {
      const v = Math.min(DISP, Math.max(0, (means[i] || 0) / ax.limit));
      // Cap just inside the outer hexagon so an at/over-limit polygon sits
      // within the limit border rather than overlapping it.
      return at(i, Math.min((v / DISP) * R, R - 3)).join(',');
    }).join(' ');

  // A vertex is "over" if any set's mean exceeds that axis's limit.
  const over = RADAR_AXES.map((ax, i) => sets.some((s) => (s.means[i] || 0) > ax.limit));
  const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  const seg = (p: [number, number], q: [number, number], red: boolean, k: string) => (
    <line
      key={k}
      x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]}
      stroke={red ? 'var(--danger)' : 'var(--muted)'}
      strokeWidth={red ? 2 : 1}
    />
  );

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" className="scatter">
      {/* grid: half ring (dashed) inside */}
      <polygon points={ringPts(0.5)} fill="none" stroke="var(--border)" strokeDasharray="3 3" />
      {/* set polygons first, so the limit hexagon draws on top of them */}
      {sets.map((s, si) => (
        <polygon
          key={si}
          points={setPts(s.means)}
          fill={s.color}
          fillOpacity={0.12}
          stroke={s.color}
          strokeWidth={1.6}
        />
      ))}
      {/* limit hexagon: a quarter of the edge nearest a single over vertex is
          red; the middle quarter is red only when BOTH ends are over (→ full). */}
      {RADAR_AXES.map((_, i) => {
        const j = (i + 1) % n;
        const a = at(i, R);
        const b = at(j, R);
        const q1 = lerp(a, b, 0.25);
        const q3 = lerp(a, b, 0.75);
        return (
          <g key={`edge${i}`}>
            {seg(a, q1, over[i], 'a')}
            {seg(q1, q3, over[i] && over[j], 'm')}
            {seg(q3, b, over[j], 'b')}
          </g>
        );
      })}
      {RADAR_AXES.map((ax, i) => {
        const [lx, ly] = at(i, R + 3);
        const c = Math.cos(ang(i));
        const s = Math.sin(ang(i));
        const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
        const dy = s > 0.3 ? '0.7em' : s < -0.3 ? '-0.25em' : '0.32em';
        return (
          <text
            key={ax.key}
            x={lx}
            y={ly}
            dy={dy}
            fontSize={9}
            fill={over[i] ? 'var(--danger)' : 'var(--muted)'}
            fontWeight={over[i] ? 600 : 400}
            textAnchor={anchor}
          >
            {ax.label}
          </text>
        );
      })}
    </svg>
  );
}

function ComparisonPlots({
  result,
  onRecolor,
}: {
  result: CmpResult;
  onRecolor?: (groupIndex: number, color: string) => void;
}) {
  const [pick, setPick] = useState<number | null>(null);
  const points: ScatterPoint[] = result.points.map((p) => ({
    x: p.x,
    y: p.y,
    color: p.color,
    id: p.label,
  }));
  const multi = result.groups.length > 1;

  // Structural-similarity cards: the two matrices stack in a column, with the
  // map to their right (see the custom layout in the render below).
  const mapCard = points.length > 0 && (
    <div key="map" className="analyse-card">
      <h3>Combined similarity map</h3>
      <ScatterPlot points={points} size={360} xLabel="UMAP 1" yLabel="UMAP 2" />
    </div>
  );
  const matrixCards = [
    result.matrix && multi && (
      <MatrixCard
        key="cross"
        title="Cross-similarity"
        hint="Mean nearest-neighbour Tanimoto from row set → column set (diagonal = internal similarity). Higher = more alike."
        groups={result.groups}
        matrix={result.matrix}
        format={(v) => v.toFixed(2)}
      />
    ),
    result.overlap && multi && (
      <MatrixCard
        key="overlap"
        title="Near-duplicate overlap"
        hint="% of the row set with a near-duplicate (Tanimoto ≥ 0.9) in the column set."
        groups={result.groups}
        matrix={result.overlap}
        format={pct}
      />
    ),
    result.spaceOverlap && multi && (
      <MatrixCard
        key="spaceOverlap"
        title="Chemical-space overlap"
        hint="% of the row set sharing a chemotype neighbourhood (Tanimoto ≥ 0.55) with the column set."
        groups={result.groups}
        matrix={result.spaceOverlap}
        format={pct}
      />
    ),
  ].filter(Boolean);

  const nnsimCard = result.nnsim && (
    <div key="nnsim" className="analyse-card">
      <h3>NN-similarity distribution</h3>
      <p className="muted small">
        Each set's nearest-neighbour Tanimoto to the other sets (0 = novel, 1 =
        duplicated). One line per set.
      </p>
      <div className="prop-grid">
        <PropChart p={result.nnsim} groups={result.groups} />
      </div>
    </div>
  );

  // One card per analysis, grouped by the same categories as the Create editor.
  const cardsByGroup: Record<string, ReactNode[]> = {
    profile: [
      result.metrics && (
        <div key="metrics" className="analyse-card">
          <h3>Set metrics</h3>
          <table className="sim-matrix metrics-table">
            <thead>
              <tr>
                <th className="rowhead">Set</th>
                <th>Diversity</th>
                <th>Novelty</th>
                <th>Ro5</th>
                <th>Veber</th>
              </tr>
            </thead>
            <tbody>
              {result.groups.map((g, i) => {
                const m = result.metrics![i];
                return (
                  <tr key={i}>
                    <th className="rowhead">
                      <span className="swatch" style={{ background: g.color }} />
                      {g.label}
                    </th>
                    <td>
                      {typeof g.internalSim === 'number'
                        ? (1 - g.internalSim).toFixed(2)
                        : '–'}
                    </td>
                    <td>{pct(m.novelty)}</td>
                    <td>{pct(m.ro5)}</td>
                    <td>{pct(m.veber)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">
            Diversity = 1 − internal similarity · Novelty = share with no
            near-analog (Tanimoto &lt; 0.4) in the other sets · Ro5 / Veber =
            drug-likeness pass rate.
          </p>
        </div>
      ),
      result.radar && result.radar.length > 0 && (
        <div key="radar" className="analyse-card">
          <h3>Drug-likeness radar</h3>
          <p className="muted small">
            Mean MW, cLogP, HBD, HBA (Ro5) + TPSA, RotB (Veber) per set, scaled
            so the solid ring marks each limit (inside = drug-like).
          </p>
          <RadarChart sets={result.radar} />
        </div>
      ),
      (result.properties?.length ?? 0) > 0 && (
        <div key="props" className="analyse-card">
          <h3>Property distributions</h3>
          <p className="muted small">
            Each numeric property normalised per set (line = one set).
          </p>
          <div className="prop-grid">
            {result.properties.map((p) => (
              <PropChart key={p.key} p={p} groups={result.groups} />
            ))}
          </div>
        </div>
      ),
      result.pca && result.pca.points.length > 0 && (
        <div key="pca" className="analyse-card">
          <h3>Property-space PCA</h3>
          <p className="muted small">
            PCA of MW, cLogP, TPSA, HBD/HBA, RotB, aromatic rings and Fsp3 —
            coloured by set (the similarity map's physicochemical counterpart).
          </p>
          <ScatterPlot
            points={result.pca.points.map((p) => ({ x: p.x, y: p.y, color: p.color }))}
            size={300}
            xLabel={`PC 1${result.pca.explained ? ` (${pct(result.pca.explained[0])})` : ''}`}
            yLabel={`PC 2${result.pca.explained ? ` (${pct(result.pca.explained[1])})` : ''}`}
          />
        </div>
      ),
      result.clusters && result.clusters.length > 0 && (
        <div key="clusters" className="analyse-card">
          <h3>Clustering</h3>
          <table className="sim-matrix metrics-table">
            <thead>
              <tr>
                <th className="rowhead">Set</th>
                <th>Clusters</th>
                <th>Singletons</th>
              </tr>
            </thead>
            <tbody>
              {result.clusters.map((c, i) => (
                <tr key={i}>
                  <th className="rowhead">
                    <span className="swatch" style={{ background: c.color }} />
                    {c.label}
                  </th>
                  <td>{c.clusters}</td>
                  <td>{c.singletons}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Butina clusters at 0.35 Tanimoto distance · singletons = unique
            chemotypes.
          </p>
        </div>
      ),
      result.bivariate && result.bivariate.points.length > 0 && (
        <div key="bivariate" className="analyse-card">
          <h3>MW vs cLogP</h3>
          <p className="muted small">
            Physicochemical property space — one point per compound, coloured by
            set.
          </p>
          <ScatterPlot
            points={result.bivariate.points.map((p) => ({ x: p.x, y: p.y, color: p.color }))}
            size={300}
            xLabel="MW"
            yLabel="cLogP"
          />
        </div>
      ),
      result.rings && result.rings.length > 0 && (
        <div key="rings" className="analyse-card">
          <h3>Ring &amp; stereo profile</h3>
          <table className="sim-matrix metrics-table">
            <thead>
              <tr>
                <th className="rowhead">Set</th>
                {RING_COLS.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rings.map((r, i) => (
                <tr key={i}>
                  <th className="rowhead">
                    <span className="swatch" style={{ background: r.color }} />
                    {r.label}
                  </th>
                  {r.means.map((m, j) => (
                    <td key={j}>{Number.isFinite(m) ? m.toFixed(1) : '–'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Mean count per compound.</p>
        </div>
      ),
      result.funcGroups && (
        <RatesCard
          key="funcGroups"
          title="Functional groups"
          hint="% of each set matching each group. Columns = sets (see legend)."
          data={result.funcGroups}
        />
      ),
      result.alerts && (
        <RatesCard
          key="alerts"
          title="Structural alerts"
          hint="% of each set hitting reactive / undesirable substructures."
          data={result.alerts}
          anyRate={result.alerts.anyRate}
        />
      ),
      result.qed && result.qed.length > 0 && (
        <div key="qed" className="analyse-card">
          <h3>QED drug-likeness</h3>
          <p className="muted small">
            Mean Bickerton QED (0 = poor, 1 = drug-like) per set.
          </p>
          <div className="qed-bars">
            {result.qed.map((q, i) => (
              <div key={i} className="qed-row">
                <span className="qed-label">
                  <span className="swatch" style={{ background: q.color }} />
                  {q.label}
                </span>
                <span className="qed-track">
                  <span
                    className="qed-fill"
                    style={{
                      width: `${Number.isFinite(q.mean) ? Math.round(q.mean * 100) : 0}%`,
                      background: q.color,
                    }}
                  />
                </span>
                <span className="qed-val">
                  {Number.isFinite(q.mean) ? q.mean.toFixed(2) : '–'}
                </span>
              </div>
            ))}
          </div>
          <p className="muted small">
            QED alerts use this app's light alert panel, not the full Brenk set.
          </p>
        </div>
      ),
      (result.ecdf?.length ?? 0) > 0 && (
        <div key="ecdf" className="analyse-card">
          <h3>Property ECDFs</h3>
          <p className="muted small">
            Cumulative distribution per property (fraction ≤ value), one line per
            set.
          </p>
          <div className="prop-grid">
            {result.ecdf!.map((p) => (
              <PropChart key={p.key} p={p} groups={result.groups} />
            ))}
          </div>
        </div>
      ),
    ],
    shape: [
      result.pmi && result.pmi.points.length > 0 && (
        <div key="pmi" className="analyse-card">
          <h3>3D shape (PMI)</h3>
          <p className="muted small">
            Rod–disc–sphere triangle; each point is one compound's principal
            moments of inertia, coloured by set.
          </p>
          <PmiOverlayPlot points={result.pmi} />
        </div>
      ),
    ],
  };

  // Route every card to a category (matching the Create-editor groups), then
  // render one result section per category.
  const CARD_GROUP: Record<string, string> = {
    map: 'similarity',
    cross: 'similarity',
    overlap: 'similarity',
    spaceOverlap: 'similarity',
    nnsim: 'similarity',
    metrics: 'diversity',
    clusters: 'diversity',
    props: 'physchem',
    ecdf: 'physchem',
    bivariate: 'physchem',
    rings: 'physchem',
    pca: 'physchem',
    pmi: 'physchem',
    funcGroups: 'medchem',
    alerts: 'medchem',
    qed: 'medchem',
    radar: 'medchem',
  };
  const keyOf = (c: ReactNode) => String((c as { key?: string | null }).key ?? '');
  const allCards = [
    mapCard,
    ...matrixCards,
    nnsimCard,
    ...(cardsByGroup.profile ?? []),
    ...(cardsByGroup.shape ?? []),
  ].filter(Boolean);
  const forGroup = (gid: string) =>
    allCards.filter((c) => CARD_GROUP[keyOf(c)] === gid);

  return (
    <div className="analyse-results-wrap">
      <div className="legend wrap">
        {result.groups.map((g, gi) => (
          <span key={g.label} className="legend-item">
            {onRecolor ? (
              <span className="legend-color">
                <button
                  className="swatch"
                  style={{ background: g.color }}
                  title="Change colour"
                  onClick={() => setPick((p) => (p === gi ? null : gi))}
                />
                {pick === gi && (
                  <span className="legend-color-menu">
                    {PALETTE.map((col) => (
                      <button
                        key={col}
                        className={`cmp-swatch${g.color === col ? ' active' : ''}`}
                        style={{ background: col }}
                        title="Colour group"
                        onClick={() => {
                          onRecolor(gi, col);
                          setPick(null);
                        }}
                      />
                    ))}
                  </span>
                )}
              </span>
            ) : (
              <span className="swatch" style={{ background: g.color }} />
            )}
            {g.label} · {g.count}
            {typeof g.internalSim === 'number' && ` · div ${(1 - g.internalSim).toFixed(2)}`}
          </span>
        ))}
      </div>

      {ANALYSIS_GROUPS.map((gp) => {
        const cards = forGroup(gp.id);
        if (cards.length === 0) return null;
        // Similarity: the matrices stack in a column, map + NN-sim to the right.
        if (gp.id === 'similarity') {
          const isMatrix = (c: ReactNode) =>
            ['cross', 'overlap', 'spaceOverlap'].includes(keyOf(c));
          const matrices = cards.filter(isMatrix);
          const rest = cards.filter((c) => !isMatrix(c));
          return (
            <section key={gp.id} className="result-section">
              <h2 className="result-section-title">{gp.label}</h2>
              <div className="analyse-results">
                {matrices.length > 0 && <div className="sim-tables">{matrices}</div>}
                {rest}
              </div>
            </section>
          );
        }
        return (
          <section key={gp.id} className="result-section">
            <h2 className="result-section-title">{gp.label}</h2>
            <div className="analyse-results">{cards}</div>
          </section>
        );
      })}
    </div>
  );
}

// ---- create view -----------------------------------------------------------

// Two illustrative set colours for the example thumbnails in the (i) tooltips.
const EX_A = '#4f9cf9';
const EX_B = '#e5894b';

/** Tiny illustrative thumbnail of what each analysis produces (tooltip). */
function AnalysisExample({ id }: { id: string }) {
  if (id === 'map' || id === 'pca' || id === 'bivariate') {
    const a = [[22, 42], [30, 34], [26, 50], [18, 38], [32, 46]];
    const b = [[86, 28], [94, 36], [82, 22], [98, 32], [90, 42]];
    return (
      <svg viewBox="0 0 120 70" className="ex-svg">
        {a.map((p, i) => (
          <circle key={`a${i}`} cx={p[0]} cy={p[1]} r={3.4} fill={EX_A} />
        ))}
        {b.map((p, i) => (
          <circle key={`b${i}`} cx={p[0]} cy={p[1]} r={3.4} fill={EX_B} />
        ))}
      </svg>
    );
  }
  if (
    id === 'crossSim' ||
    id === 'overlap' ||
    id === 'spaceOverlap' ||
    id === 'funcGroups' ||
    id === 'alerts'
  ) {
    const vals = id === 'crossSim' ? [[0.9, 0.3], [0.3, 0.85]] : [[0.7, 0.15], [0.15, 0.6]];
    return (
      <svg viewBox="0 0 120 70" className="ex-svg">
        <rect x={20} y={14} width={7} height={26} fill={EX_A} />
        <rect x={20} y={42} width={7} height={26} fill={EX_B} />
        <rect x={35} y={3} width={26} height={7} fill={EX_A} />
        <rect x={63} y={3} width={26} height={7} fill={EX_B} />
        {vals.map((row, r) =>
          row.map((v, c) => (
            <rect
              key={`${r}-${c}`}
              x={35 + c * 28}
              y={14 + r * 28}
              width={26}
              height={26}
              stroke="var(--border)"
              fill={`color-mix(in srgb, ${EX_A} ${Math.round(v * 85)}%, transparent)`}
            />
          )),
        )}
      </svg>
    );
  }
  if (id === 'metrics' || id === 'clusters' || id === 'rings' || id === 'qed') {
    const rows = [[EX_A, 0.85, 0.45], [EX_B, 0.5, 0.72]];
    return (
      <svg viewBox="0 0 120 70" className="ex-svg">
        {rows.map((r, i) => (
          <g key={i}>
            <circle cx={12} cy={24 + i * 26} r={4} fill={r[0] as string} />
            <rect x={24} y={17 + i * 26} width={(r[1] as number) * 84} height={6} rx={1} fill="var(--chart)" />
            <rect x={24} y={27 + i * 26} width={(r[2] as number) * 84} height={6} rx={1} fill="var(--chart)" opacity={0.5} />
          </g>
        ))}
      </svg>
    );
  }
  if (id === 'properties' || id === 'nnsim') {
    const curve = (cx: number, color: string) => {
      const pts: string[] = [];
      for (let x = 0; x <= 120; x += 5) {
        const y = 60 - Math.exp(-((x - cx) ** 2) / 500) * 46;
        pts.push(`${x},${y.toFixed(1)}`);
      }
      return <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} />;
    };
    return (
      <svg viewBox="0 0 120 70" className="ex-svg">
        {curve(45, EX_A)}
        {curve(74, EX_B)}
      </svg>
    );
  }
  if (id === 'ecdf') {
    // Cumulative S-curves rising from 0 to 1.
    const curve = (mid: number, color: string) => {
      const pts: string[] = [];
      for (let x = 0; x <= 120; x += 5) {
        const t = 1 / (1 + Math.exp(-(x - mid) / 10));
        pts.push(`${x},${(60 - t * 48).toFixed(1)}`);
      }
      return <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} />;
    };
    return (
      <svg viewBox="0 0 120 70" className="ex-svg">
        {curve(48, EX_A)}
        {curve(74, EX_B)}
      </svg>
    );
  }
  if (id === 'shape') {
    const px = (n1: number) => 15 + n1 * 90;
    const py = (n2: number) => 58 - ((n2 - 0.5) / 0.5) * 46;
    const dots: [number, number, string][] = [
      [0.1, 0.95, EX_A], [0.28, 0.74, EX_A], [0.55, 0.62, EX_A],
      [0.6, 0.9, EX_B], [0.85, 0.98, EX_B], [0.7, 0.8, EX_B],
    ];
    return (
      <svg viewBox="0 0 120 70" className="ex-svg">
        <polygon
          points={`${px(0)},${py(1)} ${px(1)},${py(1)} ${px(0.5)},${py(0.5)}`}
          fill="none"
          stroke="var(--border)"
        />
        {dots.map((d, i) => (
          <circle key={i} cx={px(d[0])} cy={py(d[1])} r={2.6} fill={d[2]} />
        ))}
      </svg>
    );
  }
  return null;
}

function CreateView() {
  const avail = useAvailableSources();
  const comparisons = useStore((s) => s.comparisons);
  const progress = useStore((s) => s.comparisonProgress);
  const cache = useStore((s) => s.cache);
  const saveComparison = useStore((s) => s.saveComparison);
  const removeComparison = useStore((s) => s.removeComparison);
  const runComparison = useStore((s) => s.runComparison);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  // Leave rename mode when switching tiles.
  useEffect(() => setRenaming(false), [selectedId]);

  const blank = (): Comparison => ({
    id: crypto.randomUUID(),
    name: 'New comparison',
    sources: [],
    analyses: blankAnalyses(),
    status: 'saved',
    createdAt: Date.now(),
  });

  // The editor reads the comparison straight from the store (no local copy), so
  // fields the store updates — like `computedSig` after a run — are always
  // current. Editing a stale copy used to wipe that signature on the next save.
  const editing = comparisons.find((c) => c.id === selectedId) ?? null;
  const storedStatus = editing?.status;
  const running = editing ? progress[editing.id] !== undefined : false;

  // Diff-based "needs re-run": compare the compute-affecting config signature
  // against the one that produced the current result. Toggling an option and
  // back (net no change) reads as unchanged.
  const dirty =
    !!editing &&
    editing.sources.length > 0 &&
    comparisonSig(editing) !== editing.computedSig;

  // Every edit persists instantly (no Save button); the store update re-renders
  // the editor from the fresh comparison.
  const commit = (next: Comparison) => {
    saveComparison(next);
  };

  const toggleSource = (a: AvailSource) => {
    if (!editing) return;
    const has = editing.sources.some((s) => s.sourceId === a.sourceId);
    const sources: CmpSource[] = has
      ? editing.sources.filter((s) => s.sourceId !== a.sourceId)
      : [
          ...editing.sources,
          {
            sourceId: a.sourceId,
            label: a.label,
            libName: a.libName,
            kind: a.kind,
            backend: a.backend,
            subsetId: a.subsetId,
            color: categoryColor(editing.sources.length),
            sampling: 'auto',
          },
        ];
    commit({ ...editing, sources });
  };

  const patchSource = (sourceId: string, patch: Partial<CmpSource>) => {
    if (!editing) return;
    commit({
      ...editing,
      sources: editing.sources.map((s) =>
        s.sourceId === sourceId ? { ...s, ...patch } : s,
      ),
    });
  };

  const patchAnalyses = (id: keyof ReturnType<typeof resolveAnalyses>, val: boolean) => {
    if (!editing) return;
    commit({ ...editing, analyses: { ...resolveAnalyses(editing), [id]: val } });
  };

  const doSubmit = () => {
    if (!editing || editing.sources.length === 0) return;
    runComparison(editing); // persists status + progress via the store
  };

  // Rough run-time estimate from sample sizes, set count, and enabled analyses.
  const estimateSeconds = (): number => {
    if (!editing || editing.sources.length === 0) return 0;
    const A = resolveAnalyses(editing);
    const sizeOf = (s: CmpSource): number => {
      if (typeof s.sampling === 'number') return s.sampling;
      if (s.sampling === 'auto') return AUTO_SAMPLE;
      if (s.backend === 'duckdb') return DB_ALL_CAP;
      return cache[s.libName]?.compounds.length ?? 5000;
    };
    const perSet = editing.sources.map(sizeOf);
    const total = perSet.reduce((a, b) => a + b, 0);
    const withDesc =
      A.pca || A.metrics || A.properties || A.ecdf || A.bivariate || A.rings || A.qed;
    let ms = total * (withDesc ? 3.5 : 1.1); // fingerprints (+descriptors)
    if (A.map) ms += total * 4; // UMAP
    if (A.shape) ms += perSet.reduce((s, n) => s + Math.min(80, n), 0) * 160; // conformers
    // O(n²) Tanimoto passes (main thread).
    const pairwise =
      (A.crossSim ? 1 : 0) +
      (A.overlap ? 1 : 0) +
      (A.metrics ? 1 : 0) +
      (A.nnsim ? 1 : 0) +
      (A.spaceOverlap ? 1 : 0) +
      (A.clusters ? 1 : 0);
    if (pairwise) ms += pairwise * total * total * 0.0009;
    // SMARTS pass (re-parse + substructure matches per compound).
    if (A.funcGroups || A.alerts || A.qed) ms += total * 2.5;
    return ms / 1000;
  };

  const fmtEst = (s: number): string =>
    s < 1 ? '<1 s' : s < 90 ? `~${Math.round(s)} s` : `~${Math.round(s / 60)} min`;

  const { width: leftW, onMouseDown: onResize } = useResizablePanel(
    'chemviewer-analyse-left',
  );

  return (
    <div
      className="analyse-create"
      style={{ gridTemplateColumns: `${leftW}px 5px minmax(0, 1fr)` }}
    >
      <aside className="cmp-list">
        <button
          className="cmp-new"
          onClick={() => {
            // Persist immediately so the tile appears in the list right away.
            const c = blank();
            saveComparison(c);
            setSelectedId(c.id);
          }}
        >
          + New comparison
        </button>
        {comparisons.length === 0 && (
          <div className="muted cmp-empty">No comparisons yet.</div>
        )}
        {comparisons.map((c) => (
          <div
            key={c.id}
            className={`cmp-tile${selectedId === c.id ? ' active' : ''}`}
            onClick={() => setSelectedId(c.id)}
          >
            <StatusDot status={progress[c.id] !== undefined ? 'running' : c.status} />
            <span className="cmp-tile-name">{c.name}</span>
            <span className="muted cmp-tile-n">{c.sources.length}</span>
          </div>
        ))}
      </aside>

      <div
        className="panel-resizer"
        onMouseDown={onResize}
        title="Drag to resize"
      />

      <section className="cmp-editor">
        {!editing ? (
          <div className="muted cmp-hint">
            Select a comparison to edit, or create a new one.
          </div>
        ) : (
          <>
            <div className="cmp-editor-head">
              {renaming ? (
                <input
                  className="cmp-name"
                  autoFocus
                  value={editing.name}
                  onChange={(e) => commit({ ...editing, name: e.target.value })}
                  onBlur={() => setRenaming(false)}
                  onKeyDown={(e) => e.key === 'Enter' && setRenaming(false)}
                />
              ) : (
                <div className="cmp-title">
                  <span className="cmp-title-text">{editing.name}</span>
                  <button
                    className="cmp-name-edit"
                    title="Rename"
                    onClick={() => setRenaming(true)}
                  >
                    <PencilIcon />
                  </button>
                </div>
              )}
              {dirty && !running && (
                <span className="cmp-estimate muted small">
                  est. {fmtEst(estimateSeconds())}
                </span>
              )}
              {!dirty && storedStatus === 'ready' && !running && (
                <span className="muted small">Saved ✓</span>
              )}
              {storedStatus === 'error' && !running && (
                <span className="error-inline small">
                  {editing.error ?? 'Compute failed'}
                </span>
              )}
              <button
                className="primary"
                onClick={doSubmit}
                title={
                  !dirty && storedStatus === 'ready'
                    ? 'Already computed — change a setting to re-run'
                    : undefined
                }
                disabled={running || editing.sources.length === 0 || !dirty}
              >
                {running ? 'Comparing…' : dirty ? 'Compare' : 'Compared'}
              </button>
              <button
                className="cmp-del"
                title="Delete comparison"
                onClick={() => {
                  removeComparison(editing.id);
                  setSelectedId(null);
                }}
                disabled={running}
              >
                Delete
              </button>
            </div>

            {running && (
              <div className="cmp-progress">
                <div
                  className="cmp-progress-fill"
                  style={{ width: `${Math.round((progress[editing.id] ?? 0) * 100)}%` }}
                />
              </div>
            )}

            <section className="cmp-section">
              <h3 className="cmp-section-title">Settings</h3>
              <div className="cmp-config-row">
              <div className="cmp-config-col">
            <h4>Libraries &amp; subsets</h4>
            <div className="cmp-sources">
              {avail.map((a) => {
                const chosen = editing.sources.find((s) => s.sourceId === a.sourceId);
                const mode = chosen
                  ? typeof chosen.sampling === 'number'
                    ? 'number'
                    : chosen.sampling
                  : 'auto';
                return (
                  <div key={a.sourceId} className={`cmp-src${chosen ? ' on' : ''}`}>
                    <div className="cmp-src-row">
                      <label className="cmp-src-check">
                        <input
                          type="checkbox"
                          checked={!!chosen}
                          onChange={() => toggleSource(a)}
                        />
                        <span className="cmp-src-label">{a.label}</span>
                      </label>

                      <span className="muted cmp-src-kind">
                        {a.kind === 'subset' ? 'subset' : a.backend === 'duckdb' ? 'DuckDB' : 'library'}
                      </span>

                      {chosen && (
                        <>
                          <span className="spacer" />
                          <span className="cmp-sample-size muted">samples:</span>
                          <div className="segmented cmp-sampling">
                            <button
                              className={mode === 'all' ? 'active' : ''}
                              onClick={() => patchSource(a.sourceId, { sampling: 'all' })}
                            >
                              All
                            </button>
                            {mode === 'number' ? (
                              <input
                                className="cmp-num-inline"
                                type="number"
                                min={10}
                                step={100}
                                value={chosen.sampling as number}
                                onChange={(e) =>
                                  patchSource(a.sourceId, {
                                    sampling: Math.max(10, Number(e.target.value) || 10),
                                  })
                                }
                              />
                            ) : (
                              <button
                                onClick={() => patchSource(a.sourceId, { sampling: 1000 })}
                                title="Specific number"
                              >
                                #
                              </button>
                            )}
                            <button
                              className={mode === 'auto' ? 'active' : ''}
                              onClick={() => patchSource(a.sourceId, { sampling: 'auto' })}
                            >
                              Auto
                            </button>
                          </div>

                          <span className="cmp-sample-size muted">color:</span>
                          {/* Pill-shaped colour selector: one dot that expands
                              into the full palette to the right when clicked. */}
                          <div
                            className={`cmp-color-pill${pickerFor === a.sourceId ? ' open' : ''}`}
                          >
                            {pickerFor === a.sourceId ? (
                              PALETTE.map((col) => (
                                <button
                                  key={col}
                                  className={`cmp-swatch${chosen.color === col ? ' active' : ''}`}
                                  style={{ background: col }}
                                  title="Colour group"
                                  onClick={() => {
                                    patchSource(a.sourceId, { color: col });
                                    setPickerFor(null);
                                  }}
                                />
                              ))
                            ) : (
                              <button
                                className="cmp-swatch"
                                style={{ background: chosen.color }}
                                title="Colour group"
                                onClick={() => setPickerFor(a.sourceId)}
                              />
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
              </div>

              <div className="cmp-config-col">
            <h4>Analyses</h4>
            <div className="cmp-analyses">
              {ANALYSIS_GROUPS.map((g) => {
                const A = resolveAnalyses(editing);
                const types = ANALYSIS_TYPES.filter((a) => a.group === g.id);
                return (
                  <div key={g.id} className="cmp-analysis-group">
                    <div className="cmp-analysis-group-title muted">{g.label}</div>
                    {types.map((a) => (
                      <div key={a.id} className="cmp-analysis">
                        <label className="cmp-analysis-check">
                          <input
                            type="checkbox"
                            checked={A[a.id]}
                            onChange={(e) => patchAnalyses(a.id, e.target.checked)}
                          />
                          <span className="cmp-analysis-label">
                            {a.label}
                            <span
                              className="info-icon"
                              tabIndex={0}
                              onClick={(e) => e.preventDefault()}
                            >
                              i
                              <span className="info-tip" role="tooltip">
                                <span className="info-tip-title">{a.label}</span>
                                <span className="muted small">{a.hint}</span>
                                <AnalysisExample id={a.id} />
                              </span>
                            </span>
                          </span>
                        </label>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
              </div>
              </div>
            </section>

            <section className="cmp-section">
              <h3 className="cmp-section-title">Results</h3>
              {storedStatus === 'ready' && !running ? (
                <ResultSection comparison={editing} dirty={dirty} />
              ) : (
                <div className="muted cmp-hint">
                  {running
                    ? 'Comparing…'
                    : 'Choose settings and press Compare to generate results.'}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}

// ---- result section (rendered below the config once a comparison is ready) --

function ResultSection({ comparison, dirty }: { comparison: Comparison; dirty: boolean }) {
  const comparisons = useStore((s) => s.comparisons);
  const saveComparison = useStore((s) => s.saveComparison);
  const [result, setResult] = useState<CmpResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Reload whenever the selected comparison changes or it's re-run (new sig).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadResult(comparison.id).then((r) => {
      if (alive) {
        setResult(r);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [comparison.id, comparison.computedSig]);

  // Recolour a set live: update the plots + persisted result, and sync the
  // matching source's colour in the comparison config (so a re-run keeps it).
  const recolor = (gi: number, color: string) => {
    if (!result) return;
    const old = result.groups[gi].color;
    const label = result.groups[gi].label;
    const recol = <T extends { color: string }>(p: T) =>
      p.color === old ? { ...p, color } : p;
    const updated: CmpResult = {
      ...result,
      groups: result.groups.map((g, i) => (i === gi ? { ...g, color } : g)),
      points: result.points.map((p) => (p.label === label ? { ...p, color } : p)),
      pca: result.pca ? { ...result.pca, points: result.pca.points.map(recol) } : result.pca,
      pmi: result.pmi ? { points: result.pmi.points.map(recol) } : result.pmi,
    };
    setResult(updated);
    persistResult(comparison.id, updated);
    const cmp = comparisons.find((c) => c.id === comparison.id);
    if (cmp) {
      saveComparison({
        ...cmp,
        sources: cmp.sources.map((s) => (s.label === label ? { ...s, color } : s)),
      });
    }
  };

  return (
    <div className="result-below">
      {dirty && (
        <div className="result-below-head">
          <span className="muted small">config changed — re-run to update</span>
        </div>
      )}
      {loading ? (
        <div className="muted">Loading result…</div>
      ) : result ? (
        <ComparisonPlots result={result} onRecolor={recolor} />
      ) : (
        <div className="muted">No stored result.</div>
      )}
    </div>
  );
}

// ---- page shell ------------------------------------------------------------

export function AnalysePage() {
  return (
    <div className="page">
      <header className="browse-header">
        <span className="muted small">
          Compare libraries &amp; subsets — pick sources, choose analyses, submit.
        </span>
      </header>
      <CreateView />
    </div>
  );
}
