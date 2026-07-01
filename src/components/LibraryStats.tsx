import { useMemo } from 'react';
import { useStore } from '../data/store';
import {
  computeAllStats,
  binIndexFor,
  type ColumnStats,
} from '../stats/summary';
import { SimilarityCluster } from './SimilarityCluster';
import { PMIPlot } from './PMIPlot';
import { statsViewKey } from '../chem/precompute';
import type { Compound, Library } from '../data/types';

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 0.01 || abs >= 100000)) return n.toExponential(2);
  return Number(n.toFixed(2)).toLocaleString();
}

function Histogram({
  stats,
  highlight,
}: {
  stats: ColumnStats;
  highlight: number;
}) {
  const max = Math.max(...stats.bins, 1);
  const w = 100 / stats.bins.length;
  return (
    <svg className="histogram" viewBox="0 0 100 30" preserveAspectRatio="none">
      {highlight >= 0 && (
        <rect
          x={highlight * w}
          y={0}
          width={w}
          height={30}
          fill="var(--accent)"
          fillOpacity={0.16}
        />
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

interface Props {
  library: Library;
  filteredCompounds: Compound[];
}

export function LibraryStats({ library, filteredCompounds }: Props) {
  const subsetName = useStore((s) => s.activeSubsetName());
  const hovered = useStore((s) => s.hoveredCompound);
  const rules = useStore((s) => s.rules);
  const globalSearch = useStore((s) => s.globalSearch);
  const substructure = useStore((s) => s.substructure);
  const stats = useMemo(
    () => computeAllStats(filteredCompounds, library.columns),
    [filteredCompounds, library.columns],
  );

  // Key the similarity map by library + active filters so it's cached per view.
  const simKey = statsViewKey(
    library,
    rules,
    globalSearch,
    substructure?.smarts ?? null,
  );

  const total = library.compounds.length;
  const shown = filteredCompounds.length;

  return (
    <div>
      <div className="lib-head">
        <div className="lib-name">{library.name}</div>
        <div className="lib-sub">Subset: {subsetName}</div>
      </div>

      <div className="section">
        <h3>Overview</h3>
        <div className="stat-line">
          <span>Compounds</span>
          <strong>
            {shown.toLocaleString()}
            {shown !== total && (
              <span className="muted"> / {total.toLocaleString()}</span>
            )}
          </strong>
        </div>
        <div className="stat-line">
          <span>Format</span>
          <strong>{library.sourceFormat.toUpperCase()}</strong>
        </div>
      </div>

      <div className="section">
        <h3>Property distributions</h3>
        {stats.length === 0 && (
          <div className="muted">No numeric properties.</div>
        )}
        {stats.map((s) => (
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

      <SimilarityCluster compounds={filteredCompounds} cacheKey={simKey} />

      <PMIPlot compounds={filteredCompounds} cacheKey={simKey} />
    </div>
  );
}
