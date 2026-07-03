import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../data/store';
import { computeFingerprints } from '../chem/fingerprints';
import { ensureSim, Cancelled, type SimResult } from '../chem/precompute';
import { ScatterPlot, type ScatterPoint } from './ScatterPlot';
import type { Compound } from '../data/types';

interface Props {
  compounds: Compound[];
  /** DuckDB libraries: fetch the sample on demand instead of using `compounds`. */
  fetchSample?: (n: number) => Promise<Compound[]>;
  /** Stable key (library + filter) — recompute trigger + cache key. */
  cacheKey?: string;
}

/**
 * Chemical-similarity map: Morgan fingerprints → Tanimoto → 2D UMAP layout, one
 * point per sampled compound. The spread shows how diverse the (filtered)
 * library is. Results are cached in memory + IndexedDB (see chem/precompute),
 * so a view already precomputed on the launch screen shows instantly.
 */
export function SimilarityCluster({ compounds, fetchSample, cacheKey }: Props) {
  const hovered = useStore((s) => s.hoveredCompound);
  const [running, setRunning] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [extra, setExtra] = useState<{ x: number; y: number } | null>(null);
  const projCache = useRef(new Map<string, { x: number; y: number }>());

  const key = cacheKey ?? 'default';

  useEffect(() => {
    let alive = true;
    setExtra(null);
    setResult(null);
    setError(null);
    setRunning(true);
    setProgress(0);
    projCache.current = new Map();

    const getSample = fetchSample
      ? fetchSample
      : async () => compounds;

    // Debounce so rapid filter edits don't kick off throwaway computes.
    const timer = window.setTimeout(() => {
      ensureSim(key, getSample, {
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

  const idSet = useMemo(
    () => new Set(result?.points.map((p) => p.id)),
    [result],
  );
  const points = useMemo<ScatterPoint[]>(
    () =>
      result?.points.map((p) => ({
        x: p.x,
        y: p.y,
        color: 'var(--chart)',
        id: p.id,
      })) ?? [],
    [result],
  );

  // Hovered row: highlight its point, or project an out-of-sample one onto the
  // existing map (nearest neighbour in fingerprint space).
  const inSample = !!(hovered && idSet.has(hovered.id));
  useEffect(() => {
    if (!result || !hovered || inSample || !hovered.smiles) {
      setExtra(null);
      return;
    }
    const id = hovered.id;
    const hit = projCache.current.get(id);
    if (hit) {
      setExtra(hit);
      return;
    }
    let alive = true;
    computeFingerprints([hovered.smiles]).then(([fp]) => {
      if (!alive || !fp) return;
      const p = result.project(Array.from(fp));
      if (p) {
        projCache.current.set(id, p);
        if (alive) setExtra(p);
      }
    });
    return () => {
      alive = false;
    };
  }, [hovered, result, inSample]);

  const pct = Math.round(progress * 100);

  return (
    <div className="section">
      <h3>
        Similarity map
        {running && (
          <span className="muted"> · computing {pct > 0 ? `${pct}%` : '…'}</span>
        )}
      </h3>
      <div className="cluster-meta muted">
        {result
          ? `${result.sampled.toLocaleString()} sampled · Morgan/Tanimoto UMAP`
          : 'Morgan/Tanimoto · 2D UMAP'}
      </div>
      <div className="scatter-box">
        {result ? (
          <ScatterPlot
            points={points}
            size={280}
            highlightId={inSample ? hovered?.id : undefined}
            extra={inSample ? null : extra}
            xLabel="UMAP 1"
            yLabel="UMAP 2"
          />
        ) : (
          <span className="muted">{error ?? (running ? 'Computing…' : '—')}</span>
        )}
      </div>
    </div>
  );
}
