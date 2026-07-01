import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../data/store';
import {
  dbSample,
  dbStats,
  type DbColumnStats,
  type DbStats as DbStatsResult,
} from '../data/dbClient';
import { binIndexFor } from '../stats/summary';
import { SimilarityCluster } from './SimilarityCluster';
import { PMIPlot } from './PMIPlot';
import { statsViewKey } from '../chem/precompute';
import type { Library } from '../data/types';

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 0.01 || abs >= 100000)) return n.toExponential(2);
  return Number(n.toFixed(2)).toLocaleString();
}

function Histogram({ stats, highlight }: { stats: DbColumnStats; highlight: number }) {
  const max = Math.max(...stats.bins, 1);
  const w = 100 / stats.bins.length;
  return (
    <svg className="histogram" viewBox="0 0 100 30" preserveAspectRatio="none">
      {highlight >= 0 && (
        <rect x={highlight * w} y={0} width={w} height={30} fill="var(--accent)" fillOpacity={0.16} />
      )}
      {stats.bins.map((c, i) => {
        const h = (c / max) * 28;
        return (
          <rect
            key={i}
            x={i * w}
            y={30 - h}
            width={w * 0.9}
            height={h}
            fill={i === highlight ? 'var(--accent)' : 'var(--chart)'}
          />
        );
      })}
    </svg>
  );
}

// Cache stats results by library + filter so switching back is instant.
const statsCache = new Map<string, DbStatsResult>();

export function DbStats({ library }: { library: Library }) {
  const rules = useStore((s) => s.rules);
  const globalSearch = useStore((s) => s.globalSearch);
  const hovered = useStore((s) => s.hoveredCompound);

  const query = useMemo(() => ({ rules, globalSearch }), [rules, globalSearch]);
  const queryKey = useMemo(() => JSON.stringify(query), [query]);
  const statsKey = `${library.name}|${queryKey}`;

  const [result, setResult] = useState<DbStatsResult | null>(
    () => statsCache.get(statsKey) ?? null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const hit = statsCache.get(statsKey);
    if (hit) {
      setResult(hit);
      setLoading(false);
      return;
    }
    setResult(null);
    setLoading(true);
    // Debounce so rapid filter edits don't spam the engine.
    const t = window.setTimeout(() => {
      dbStats(library.name, query)
        .then(
          (r) =>
            alive && (statsCache.set(statsKey, r), setResult(r), setLoading(false)),
        )
        .catch(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [statsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="lib-head">
        <div className="lib-name">{library.name}</div>
        <div className="lib-sub">
          DuckDB · {(library.total ?? 0).toLocaleString()} compounds
        </div>
      </div>

      <div className="section">
        <h3>Overview</h3>
        <div className="stat-line">
          <span>Matching</span>
          <strong>
            {result ? result.count.toLocaleString() : '…'}
            {result && result.count !== (library.total ?? 0) && (
              <span className="muted"> / {(library.total ?? 0).toLocaleString()}</span>
            )}
          </strong>
        </div>
      </div>

      <div className="section">
        <h3>Property distributions {loading && <span className="muted">· …</span>}</h3>
        {/* While stats load, render placeholder blocks for the known numeric
            columns so the panel layout stays put. */}
        {!result &&
          library.columns
            .filter((c) => c.kind === 'number')
            .map((c) => (
              <div className="stat-block" key={c.key}>
                <div className="stat-head">
                  <span>{c.label}</span>
                  <span className="muted">…</span>
                </div>
                <div className="histogram placeholder" />
                <div className="stat-sub muted">&nbsp;</div>
              </div>
            ))}
        {result?.columns.length === 0 && <div className="muted">No numeric properties.</div>}
        {result?.columns.map((s) => (
          <div className="stat-block" key={s.key}>
            <div className="stat-head">
              <span>{s.label}</span>
              <span className="muted">
                {fmt(s.min)} – {fmt(s.max)}
              </span>
            </div>
            <Histogram
              stats={s}
              highlight={hovered ? binIndexFor(s, hovered.props[s.key]) : -1}
            />
            <div className="stat-sub muted">
              mean {fmt(s.mean)} · median {fmt(s.median)}
            </div>
          </div>
        ))}
      </div>

      <SimilarityCluster
        compounds={[]}
        cacheKey={statsViewKey(library, rules, globalSearch, null)}
        fetchSample={(n) => dbSample(library.name, query, n)}
      />

      <PMIPlot
        compounds={[]}
        cacheKey={statsViewKey(library, rules, globalSearch, null)}
        fetchSample={(n) => dbSample(library.name, query, n)}
      />

      <div className="section">
        <h3>Substructure</h3>
        <div className="muted">
          Substructure search over all {(library.total ?? 0).toLocaleString()}{' '}
          compounds needs a chemistry index — deferred.
        </div>
      </div>
    </div>
  );
}
