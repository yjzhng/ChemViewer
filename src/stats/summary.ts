/** Lightweight descriptive statistics for numeric columns. */
import type { ColumnDef, Compound } from '../data/types';

export interface ColumnStats {
  key: string;
  label: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  /** Histogram bin counts across [min, max]. */
  bins: number[];
}

function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function computeColumnStats(
  compounds: Compound[],
  column: ColumnDef,
  binCount = 24,
): ColumnStats | null {
  const values: number[] = [];
  for (const c of compounds) {
    const v = c.props[column.key];
    if (typeof v === 'number' && !Number.isNaN(v)) values.push(v);
  }
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;

  const bins = new Array<number>(binCount).fill(0);
  const span = max - min;
  for (const v of values) {
    const idx =
      span === 0
        ? 0
        : Math.min(binCount - 1, Math.floor(((v - min) / span) * binCount));
    bins[idx]++;
  }

  return {
    key: column.key,
    label: column.label,
    count: values.length,
    min,
    max,
    mean,
    median: quantileSorted(sorted, 0.5),
    bins,
  };
}

/** Which histogram bin a value falls into, or -1 if not applicable. */
export function binIndexFor(stats: ColumnStats, value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return -1;
  const span = stats.max - stats.min;
  if (span === 0) return 0;
  if (value < stats.min || value > stats.max) return -1;
  const idx = Math.floor(((value - stats.min) / span) * stats.bins.length);
  return Math.min(stats.bins.length - 1, Math.max(0, idx));
}

/** Stats for every numeric column of a library, over the given compounds. */
export function computeAllStats(
  compounds: Compound[],
  columns: ColumnDef[],
): ColumnStats[] {
  return columns
    .filter((c) => c.kind === 'number')
    .map((c) => computeColumnStats(compounds, c))
    .filter((s): s is ColumnStats => s !== null);
}
