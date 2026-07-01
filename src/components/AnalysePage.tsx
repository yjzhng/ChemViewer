import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { buildSources, type CompoundSource } from '../data/sources';
import { computeFingerprints, tanimoto, type Fingerprint } from '../chem/fingerprints';
import { similarityMatrix } from '../chem/clustering';
import { classicalMDS } from '../stats/embedding';
import { sampleIndices } from '../stats/sample';
import { ScatterPlot, categoryColor, type ScatterPoint } from './ScatterPlot';
import type { Library } from '../data/types';

const SAMPLE = 300;
const NN_BINS = 20;

interface AnalyseResult {
  nnSim: number[];
  bins: number[];
  mean: number;
  median: number;
  fracSimilar: number;
  points: ScatterPoint[];
  queryN: number;
  refN: number;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function fpsForSource(src: CompoundSource): Promise<Fingerprint[]> {
  const idx = sampleIndices(src.compounds.length, SAMPLE);
  const raw = await computeFingerprints(idx.map((i) => src.compounds[i].smiles));
  return raw.filter((f): f is Fingerprint => f !== null);
}

export function AnalysePage() {
  const active = useStore((s) => s.library);
  const extras = useStore((s) => s.extras);
  const subsets = useStore((s) => s.subsets);

  const libraries = useMemo(() => {
    const map = new Map<string, Library>();
    if (active) map.set(active.id, active);
    for (const l of Object.values(extras)) map.set(l.id, l);
    return [...map.values()];
  }, [active, extras]);

  const sources = useMemo(
    () => buildSources(libraries, subsets),
    [libraries, subsets],
  );

  const [queryId, setQueryId] = useState('');
  const [refId, setRefId] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyseResult | null>(null);

  const query = sources.find((s) => s.id === queryId) ?? sources[0];
  const reference =
    sources.find((s) => s.id === refId) ?? sources[1] ?? sources[0];

  const run = async () => {
    if (!query || !reference) return;
    setRunning(true);
    setError(null);
    try {
      const [qFps, rFps] = await Promise.all([
        fpsForSource(query),
        fpsForSource(reference),
      ]);
      if (qFps.length === 0 || rFps.length === 0) {
        setError('Not enough valid structures in one of the sources.');
        setResult(null);
        return;
      }

      // Nearest-neighbour Tanimoto: each query compound vs the reference set.
      const nnSim: number[] = [];
      const bins = new Array<number>(NN_BINS).fill(0);
      for (const q of qFps) {
        let best = 0;
        for (const r of rFps) {
          const s = tanimoto(q, r);
          if (s > best) best = s;
        }
        nnSim.push(best);
        bins[Math.min(NN_BINS - 1, Math.floor(best * NN_BINS))]++;
      }

      // Combined 2D map coloured by set (query = 0, reference = 1).
      const union = [...qFps, ...rFps];
      const sim = similarityMatrix(union);
      const mds = classicalMDS(sim, union.length);
      const points: ScatterPoint[] = union.map((_, i) => ({
        x: mds.x[i],
        y: mds.y[i],
        color: i < qFps.length ? categoryColor(0) : categoryColor(3),
        id: i < qFps.length ? 'query' : 'reference',
      }));

      setResult({
        nnSim,
        bins,
        mean: nnSim.reduce((a, b) => a + b, 0) / nnSim.length,
        median: median(nnSim),
        fracSimilar: nnSim.filter((s) => s >= 0.7).length / nnSim.length,
        points,
        queryN: qFps.length,
        refN: rFps.length,
      });
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setRunning(false);
    }
  };

  if (sources.length === 0) {
    return (
      <div className="page-simple">
        <div className="empty">
          <h2>Nothing to analyse yet</h2>
          <p>Load a library (Browse) first, then compare sets here.</p>
        </div>
      </div>
    );
  }

  const maxBin = result ? Math.max(...result.bins, 1) : 1;

  return (
    <div className="page-simple analyse">
      <h2>Chemical similarity comparison</h2>
      <p className="muted">
        Compare a query set against a reference by Morgan-fingerprint Tanimoto
        similarity. Each set is sampled to {SAMPLE} compounds.
      </p>

      <div className="analyse-controls">
        <label>
          Query
          <select
            value={query?.id}
            onChange={(e) => setQueryId(e.target.value)}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reference
          <select
            value={reference?.id}
            onChange={(e) => setRefId(e.target.value)}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={run} disabled={running}>
          {running ? 'Computing…' : 'Compare'}
        </button>
      </div>

      {error && <div className="error-inline">{error}</div>}

      {result && (
        <div className="analyse-results">
          <div className="analyse-card">
            <h3>Nearest-neighbour similarity</h3>
            <div className="summary-row">
              <span>mean</span>
              <strong>{result.mean.toFixed(3)}</strong>
              <span>median</span>
              <strong>{result.median.toFixed(3)}</strong>
              <span>≥ 0.7</span>
              <strong>{(result.fracSimilar * 100).toFixed(0)}%</strong>
            </div>
            <svg className="histogram tall" viewBox="0 0 100 50" preserveAspectRatio="none">
              {result.bins.map((c, i) => {
                const h = (c / maxBin) * 48;
                const w = 100 / NN_BINS;
                return (
                  <rect
                    key={i}
                    x={i * w}
                    y={50 - h}
                    width={w * 0.9}
                    height={h}
                    fill="var(--chart)"
                  />
                );
              })}
            </svg>
            <div className="axis muted">
              <span>0</span>
              <span>Tanimoto to nearest reference</span>
              <span>1</span>
            </div>
          </div>

          <div className="analyse-card">
            <h3>
              Combined similarity map
              <span className="legend">
                <span className="swatch" style={{ background: categoryColor(0) }} />
                query · {result.queryN}
                <span className="swatch" style={{ background: categoryColor(3) }} />
                reference · {result.refN}
              </span>
            </h3>
            <ScatterPlot points={result.points} size={340} />
          </div>
        </div>
      )}
    </div>
  );
}
