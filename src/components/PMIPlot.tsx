import { useEffect, useRef, useState } from 'react';
import { useStore } from '../data/store';
import type { NPR } from '../chem/pmi';
import { nprOne } from '../chem/computeClient';
import { ensurePMI, Cancelled, type PmiResult } from '../chem/precompute';
import type { Compound } from '../data/types';

interface Props {
  compounds: Compound[];
  fetchSample?: (n: number) => Promise<Compound[]>;
  cacheKey?: string;
}

const SIZE = 280;
const PAD = 22;
const INNER = SIZE - PAD * 2;
// NPR1 ∈ [0,1] → x; NPR2 ∈ [0.5,1] → y (1 at top). Vertices: rod, disc, sphere.
const px = (npr1: number) => PAD + Math.max(0, Math.min(1, npr1)) * INNER;
const py = (npr2: number) =>
  PAD + (1 - Math.max(0, Math.min(1, (npr2 - 0.5) / 0.5))) * INNER;

/**
 * PMI shape plot: a 3D conformer per sampled compound (OpenChemLib) → NPR1/NPR2
 * on the rod–disc–sphere triangle. Results are cached in memory + IndexedDB
 * (see chem/precompute) so a view precomputed on launch shows instantly. The
 * hovered row is marked (computing its NPR on the fly if it wasn't sampled).
 */
export function PMIPlot({ compounds, fetchSample, cacheKey }: Props) {
  const hovered = useStore((s) => s.hoveredCompound);
  const [running, setRunning] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PmiResult | null>(null);
  const [extra, setExtra] = useState<NPR | null>(null);
  const projCache = useRef(new Map<string, NPR | null>());

  const key = cacheKey ?? 'default';

  useEffect(() => {
    let alive = true;
    setExtra(null);
    setResult(null);
    setError(null);
    setRunning(true);
    setProgress(0);
    projCache.current = new Map();

    const getSample = fetchSample ? fetchSample : async () => compounds;

    const timer = window.setTimeout(() => {
      ensurePMI(key, getSample, {
        shouldStop: () => !alive,
        onProgress: (frac) => alive && setProgress(frac),
      })
        .then((r) => {
          if (!alive) return;
          setResult(r);
          setRunning(false);
        })
        .catch((e) => {
          if (!alive || e instanceof Cancelled) return;
          setError(String((e as Error)?.message ?? e));
          setRunning(false);
        });
    }, 450);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Hovered row: highlight its point, computing the NPR if it wasn't sampled.
  const inSample = !!(hovered && result?.byId.has(hovered.id));
  useEffect(() => {
    if (!result || !hovered || inSample || !hovered.smiles) {
      setExtra(null);
      return;
    }
    const id = hovered.id;
    if (projCache.current.has(id)) {
      setExtra(projCache.current.get(id) ?? null);
      return;
    }
    let alive = true;
    nprOne(hovered.smiles).then((npr) => {
      projCache.current.set(id, npr);
      if (alive) setExtra(npr);
    });
    return () => {
      alive = false;
    };
  }, [hovered, result, inSample]);

  const mark =
    inSample && hovered ? result?.byId.get(hovered.id) ?? null : extra;
  const pct = Math.round(progress * 100);

  return (
    <div className="section">
      <h3>
        PMI shape
        {running && (
          <span className="muted"> · computing {pct > 0 ? `${pct}%` : '…'}</span>
        )}
      </h3>
      <div className="cluster-meta muted">
        {result
          ? `${result.sampled.toLocaleString()} sampled · NPR1 vs NPR2`
          : '3D conformer · moments of inertia'}
      </div>
      <div className="scatter-box">
        {result ? (
          <svg
            className="scatter"
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            width="100%"
            preserveAspectRatio="xMidYMid meet"
          >
            <rect x={0} y={0} width={SIZE} height={SIZE} fill="var(--bg)" rx={6} />
            <polygon
              points={`${px(0)},${py(1)} ${px(1)},${py(1)} ${px(0.5)},${py(0.5)}`}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text x={px(0)} y={py(1) - 5} fontSize={9} fill="var(--muted)">
              rod
            </text>
            <text
              x={px(1)}
              y={py(1) - 5}
              fontSize={9}
              fill="var(--muted)"
              textAnchor="end"
            >
              sphere
            </text>
            <text
              x={px(0.5)}
              y={py(0.5) + 11}
              fontSize={9}
              fill="var(--muted)"
              textAnchor="middle"
            >
              disc
            </text>
            {result.points.map((p, i) => (
              <circle
                key={i}
                cx={px(p.npr1)}
                cy={py(p.npr2)}
                r={1.7}
                fill="var(--chart)"
                fillOpacity={0.4}
              >
                <title>{p.id}</title>
              </circle>
            ))}
            {mark && (
              <circle
                cx={px(mark.npr1)}
                cy={py(mark.npr2)}
                r={5}
                fill="var(--accent)"
                stroke="var(--bg)"
                strokeWidth={1.5}
              />
            )}
          </svg>
        ) : (
          <span className="muted">{error ?? (running ? 'Computing…' : '—')}</span>
        )}
      </div>
    </div>
  );
}
