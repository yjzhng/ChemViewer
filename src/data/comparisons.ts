/**
 * Saved library-comparison "jobs" for the Analyse page.
 *
 * A comparison is a named configuration (which libraries/subsets, colour per
 * set, sampling per set). Its config and its computed result are both persisted
 * to IndexedDB, so a comparison marked "ready" reopens instantly across
 * sessions — which is what makes heavier analyses (large samples / "all") worth
 * running once.
 */
import { pcGet, pcSet, pcDelete } from './precomputeCache';
import { simRequest, pmiRequest } from '../chem/computeClient';
import { FUNCTIONAL_GROUPS, STRUCTURAL_ALERTS } from '../chem/smartsPanels';
import { tanimotoDistanceWords } from '../chem/fingerprints';
import {
  overlapMatrix,
  setMetrics,
  descriptorPCA,
  nnDistribution,
  butinaClusters,
  qed,
  type SetMetrics,
  type PcaPoint,
} from './comparisonAnalyses';
import type { Compound } from './types';

/** auto = the default sample, all = the whole set, number = a specific count. */
export type Sampling = 'auto' | 'all' | number;
export const AUTO_SAMPLE = 400;
/** Cap for "all" on a DuckDB (on-disk) library — the full set is far too big. */
export const DB_ALL_CAP = 10000;

export interface CmpSource {
  sourceId: string;
  label: string;
  libName: string;
  kind: 'library' | 'subset';
  backend: 'memory' | 'duckdb';
  subsetId?: string;
  color: string;
  sampling: Sampling;
}

export type CmpStatus = 'saved' | 'running' | 'ready' | 'error';

/** Which analyses a comparison computes. */
export interface CmpAnalyses {
  map: boolean;
  crossSim: boolean;
  overlap: boolean;
  nnsim: boolean;
  spaceOverlap: boolean;
  properties: boolean;
  metrics: boolean;
  pca: boolean;
  clusters: boolean;
  ecdf: boolean;
  bivariate: boolean;
  rings: boolean;
  funcGroups: boolean;
  alerts: boolean;
  qed: boolean;
  shape: boolean;
}

/** Categories the analysis options are grouped under, in display order. */
export const ANALYSIS_GROUPS: { id: string; label: string }[] = [
  { id: 'similarity', label: 'Similarity & overlap' },
  { id: 'diversity', label: 'Diversity' },
  { id: 'physchem', label: 'Physicochemical & shape' },
  { id: 'medchem', label: 'Substructure & drug-likeness' },
];

export const ANALYSIS_TYPES: {
  id: keyof CmpAnalyses;
  label: string;
  hint: string;
  group: string;
}[] = [
  { id: 'map', label: 'Similarity map (UMAP)', hint: '2D Morgan/Tanimoto layout', group: 'similarity' },
  { id: 'crossSim', label: 'Cross-similarity matrix', hint: 'mean nearest-neighbour Tanimoto between sets', group: 'similarity' },
  { id: 'overlap', label: 'Near-duplicate overlap', hint: '% with a ≥ 0.9 match across sets', group: 'similarity' },
  { id: 'nnsim', label: 'NN-similarity distribution', hint: 'histogram of each set’s nearest-neighbour Tanimoto to the other sets', group: 'similarity' },
  { id: 'spaceOverlap', label: 'Chemical-space overlap', hint: '% sharing a chemotype neighbourhood (Tanimoto ≥ 0.55) across sets', group: 'similarity' },
  { id: 'metrics', label: 'Set metrics', hint: 'diversity, novelty, drug-likeness pass rates', group: 'diversity' },
  { id: 'clusters', label: 'Clustering', hint: 'Butina cluster + singleton counts per set', group: 'diversity' },
  { id: 'properties', label: 'Property distributions', hint: 'overlaid per-property histograms', group: 'physchem' },
  { id: 'ecdf', label: 'Property ECDFs', hint: 'cumulative property distributions per set', group: 'physchem' },
  { id: 'bivariate', label: 'MW vs cLogP', hint: 'bivariate property scatter, coloured by set', group: 'physchem' },
  { id: 'rings', label: 'Ring & stereo profile', hint: 'mean ring counts + stereocentres per set', group: 'physchem' },
  { id: 'pca', label: 'Property-space PCA', hint: 'PCA of physicochemical descriptors', group: 'physchem' },
  { id: 'shape', label: '3D shape (PMI)', hint: 'slow — a conformer per compound', group: 'physchem' },
  { id: 'funcGroups', label: 'Functional groups', hint: 'per-set hit rate for a panel of common groups', group: 'medchem' },
  { id: 'alerts', label: 'Structural alerts', hint: 'per-set rate of reactive / undesirable substructures', group: 'medchem' },
  { id: 'qed', label: 'QED drug-likeness', hint: 'mean Bickerton QED (0–1) per set', group: 'medchem' },
];

const DEFAULT_ANALYSES: CmpAnalyses = {
  map: true,
  crossSim: true,
  overlap: true,
  nnsim: false,
  spaceOverlap: false,
  properties: true,
  metrics: true,
  pca: true,
  clusters: false,
  ecdf: false,
  bivariate: false,
  rings: false,
  funcGroups: false,
  alerts: false,
  qed: false,
  shape: false,
};

/** Resolve a comparison's analysis flags, defaulting + filling missing keys. */
export function resolveAnalyses(cmp: {
  analyses?: Partial<CmpAnalyses>;
  includeShape?: boolean;
}): CmpAnalyses {
  const base: CmpAnalyses = { ...DEFAULT_ANALYSES };
  if (cmp.analyses) return { ...base, ...cmp.analyses };
  return { ...base, shape: !!cmp.includeShape };
}

// A new comparison starts with every analysis enabled (the user unchecks what
// they don't want). DEFAULT_ANALYSES stays conservative — it's only the base
// for filling missing keys on OLDER saved comparisons, so re-opening those
// doesn't silently turn on analyses they never had.
export const blankAnalyses = (): CmpAnalyses => ({
  map: true,
  crossSim: true,
  overlap: true,
  nnsim: true,
  spaceOverlap: true,
  properties: true,
  metrics: true,
  pca: true,
  clusters: true,
  ecdf: true,
  bivariate: true,
  rings: true,
  funcGroups: true,
  alerts: true,
  qed: true,
  shape: true,
});

export interface Comparison {
  id: string;
  name: string;
  sources: CmpSource[];
  status: CmpStatus;
  /** Which analyses to compute (falls back to defaults for older jobs). */
  analyses?: CmpAnalyses;
  /** Legacy flag (superseded by `analyses.shape`). */
  includeShape?: boolean;
  /** Signature of the config that produced the current result (see comparisonSig). */
  computedSig?: string;
  /** Failure reason when status === 'error'. */
  error?: string;
  createdAt: number;
}

/**
 * Stable signature of the compute-affecting config (sources + their sampling +
 * enabled analyses) — NOT colour, name, or source order. Two configs with the
 * same signature produce the same result, so a comparison whose signature still
 * matches its last run needs no re-compute.
 */
export function comparisonSig(cmp: Comparison): string {
  const src = cmp.sources.map((s) => `${s.sourceId}:${s.sampling}`).sort();
  return JSON.stringify({ src, a: resolveAnalyses(cmp) });
}

export interface CmpPoint {
  x: number;
  y: number;
  color: string;
  label: string;
}
export interface CmpGroup {
  label: string;
  color: string;
  count: number;
  /** Internal similarity: mean nearest-neighbour Tanimoto within the set. */
  internalSim: number;
}
/** One property, with a per-set normalised histogram over a shared range. */
export interface PropOverlay {
  key: string;
  min: number;
  max: number;
  /** bins[groupIndex] = normalised (0..1) bin heights. */
  bins: number[][];
}
export interface PmiOverlay {
  points: { npr1: number; npr2: number; color: string }[];
}

/**
 * Axes of the drug-likeness radar (descriptor key + label + limit). Lipinski
 * Ro5 (MW, cLogP, HBD, HBA) plus Veber (TPSA, RotB) — all "within the limit is
 * better", so they share one radial scale.
 */
export const RADAR_AXES: { key: string; label: string; limit: number }[] = [
  { key: 'amw', label: 'MW', limit: 500 },
  { key: 'CrippenClogP', label: 'cLogP', limit: 5 },
  { key: 'NumHBD', label: 'HBD', limit: 5 },
  { key: 'NumHBA', label: 'HBA', limit: 10 },
  { key: 'tpsa', label: 'TPSA', limit: 140 },
  { key: 'NumRotatableBonds', label: 'RotB', limit: 10 },
];

/** Columns of the ring-system / stereo profile table (mean per compound). */
export const RING_COLS: { key: string; label: string }[] = [
  { key: 'NumRings', label: 'Rings' },
  { key: 'NumAromaticRings', label: 'Aromatic' },
  { key: 'NumAliphaticRings', label: 'Aliphatic' },
  { key: 'NumAromaticHeterocycles', label: 'Ar. hetero' },
  { key: 'NumAtomStereoCenters', label: 'Stereo' },
];
export interface CmpResult {
  points: CmpPoint[];
  groups: CmpGroup[];
  /** Cross-similarity matrix: mean nearest-neighbour Tanimoto, groups × groups. */
  matrix?: number[][];
  /** Overlaid physicochemical property distributions, one line per set. */
  properties: PropOverlay[];
  /** % of each row set with a near-duplicate (Tanimoto ≥ 0.9) in each column set. */
  overlap?: number[][];
  /** Per-set novelty / clustering / drug-likeness. */
  metrics?: SetMetrics[];
  /** 2D PCA of RDKit descriptor space, coloured per set (+ explained variance). */
  pca?: { points: PcaPoint[]; explained?: [number, number] } | null;
  /** Mean Ro5 descriptors per set (aligned to RADAR_AXES) for the radar chart. */
  radar?: { label: string; color: string; means: number[] }[];
  /** Per-set histogram of nearest-neighbour Tanimoto to the other sets. */
  nnsim?: PropOverlay;
  /** % sharing a chemotype neighbourhood (Tanimoto ≥ 0.55), groups × groups. */
  spaceOverlap?: number[][];
  /** Butina cluster + singleton counts per set. */
  clusters?: { label: string; color: string; clusters: number; singletons: number }[];
  /** Cumulative property distributions per set (one line per set). */
  ecdf?: PropOverlay[];
  /** MW vs cLogP bivariate scatter, coloured per set. */
  bivariate?: { points: PcaPoint[] };
  /** Mean ring / stereo counts per set (aligned to RING_COLS). */
  rings?: { label: string; color: string; means: number[] }[];
  /** Functional-group hit rates: rows = groups, columns = sets. */
  funcGroups?: SmartsRates;
  /** Structural-alert hit rates + a per-set "any alert" rate. */
  alerts?: SmartsRates & { anyRate: number[] };
  /** Mean QED (weighted drug-likeness, 0–1) per set. */
  qed?: { label: string; color: string; mean: number }[];
  /** Optional 3D-shape cloud (rod–disc–sphere), coloured per set. */
  pmi?: PmiOverlay;
}

export interface SmartsRates {
  setLabels: string[];
  setColors: string[];
  rows: { label: string; fractions: number[] }[];
}

/** Mean of a descriptor column (by key name) over a group's descriptor rows. */
function meanDesc(D: number[][], keys: string[], key: string): number {
  const ki = keys.indexOf(key);
  if (ki < 0) return NaN;
  let sum = 0;
  let n = 0;
  for (const d of D) {
    const v = d[ki];
    if (Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : NaN;
}

const DESC_LABELS: Record<string, string> = {
  amw: 'MW',
  CrippenClogP: 'cLogP',
  tpsa: 'TPSA',
  NumHBD: 'HBD',
  NumHBA: 'HBA',
  NumRotatableBonds: 'RotB',
  NumAromaticRings: 'Ar. rings',
  FractionCSP3: 'Frac. Csp3',
};

/** Property overlays computed from RDKit descriptors (fallback / structure-only sets). */
function descriptorOverlays(
  descsByGroup: number[][][],
  keys: string[],
): PropOverlay[] {
  const out: PropOverlay[] = [];
  for (let ki = 0; ki < keys.length; ki++) {
    const valsByGroup = descsByGroup.map((D) =>
      D.map((d) => d[ki]).filter((v) => Number.isFinite(v)),
    );
    let min = Infinity;
    let max = -Infinity;
    for (const vals of valsByGroup)
      for (const v of vals) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    if (!(max > min)) continue;
    const bins = valsByGroup.map((vals) => {
      if (vals.length < 5) return [];
      const b = new Array<number>(PROP_BINS).fill(0);
      for (const v of vals) {
        let bi = Math.floor(((v - min) / (max - min)) * PROP_BINS);
        if (bi < 0) bi = 0;
        if (bi >= PROP_BINS) bi = PROP_BINS - 1;
        b[bi]++;
      }
      const mx = Math.max(...b, 1);
      return b.map((x) => x / mx);
    });
    out.push({ key: DESC_LABELS[keys[ki]] ?? keys[ki], min, max, bins });
  }
  return out;
}

/** Cumulative descriptor distributions per set (ECDF: fraction ≤ each bin edge). */
function descriptorEcdf(descsByGroup: number[][][], keys: string[]): PropOverlay[] {
  const out: PropOverlay[] = [];
  for (let ki = 0; ki < keys.length; ki++) {
    const valsByGroup = descsByGroup.map((D) =>
      D.map((d) => d[ki]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b),
    );
    let min = Infinity;
    let max = -Infinity;
    for (const vals of valsByGroup)
      for (const v of vals) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    if (!(max > min)) continue;
    const bins = valsByGroup.map((vals) => {
      if (vals.length < 5) return [];
      const arr = new Array<number>(PROP_BINS);
      for (let b = 0; b < PROP_BINS; b++) {
        const edge = min + ((b + 1) / PROP_BINS) * (max - min);
        let c = 0;
        for (const v of vals) {
          if (v <= edge) c++;
          else break;
        }
        arr[b] = c / vals.length;
      }
      return arr;
    });
    out.push({ key: DESC_LABELS[keys[ki]] ?? keys[ki], min, max, bins });
  }
  return out;
}

/** MW vs cLogP scatter, one point per compound, coloured per set. */
function bivariateScatter(
  groups: { src: CmpSource }[],
  descsByGroup: number[][][],
  keys: string[],
): { points: PcaPoint[] } | undefined {
  const iX = keys.indexOf('amw');
  const iY = keys.indexOf('CrippenClogP');
  if (iX < 0 || iY < 0) return undefined;
  const points: PcaPoint[] = [];
  descsByGroup.forEach((D, gi) => {
    for (const d of D) {
      if (Number.isFinite(d[iX]) && Number.isFinite(d[iY])) {
        points.push({ x: d[iX], y: d[iY], color: groups[gi].src.color });
      }
    }
  });
  return points.length ? { points } : undefined;
}

const PROP_BINS = 24;

/** Build overlaid property histograms for numeric columns shared by all sets. */
function buildProperties(
  groups: { compounds: Compound[] }[],
): PropOverlay[] {
  // Collect finite numeric values per key, per group.
  const perGroup = groups.map((g) => {
    const vals = new Map<string, number[]>();
    for (const c of g.compounds) {
      for (const [k, v] of Object.entries(c.props)) {
        const n = typeof v === 'number' ? v : parseFloat(String(v));
        if (Number.isFinite(n)) {
          if (!vals.has(k)) vals.set(k, []);
          vals.get(k)!.push(n);
        }
      }
    }
    return vals;
  });

  // Coverage threshold per group (enough values to be worth binning).
  const covered = (gi: number, arr: number[] | undefined) =>
    (arr?.length ?? 0) >= Math.min(20, Math.max(3, groups[gi].compounds.length * 0.5));

  // Only columns present with coverage in EVERY set — so every chart shows a
  // line for every set. Mismatched-schema comparisons fall through to the
  // descriptor-based overlays (computed uniformly for all sets) instead.
  const keys = (perGroup[0] ? [...perGroup[0].keys()] : []).filter((k) =>
    perGroup.every((vals, gi) => covered(gi, vals.get(k))),
  );

  const out: PropOverlay[] = [];
  for (const key of keys) {
    let min = Infinity;
    let max = -Infinity;
    perGroup.forEach((vals, gi) => {
      const arr = vals.get(key);
      if (covered(gi, arr)) for (const v of arr!) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    });
    if (!(max > min)) continue;
    // bins[gi] is empty for groups that don't have this property (no line drawn).
    const bins = perGroup.map((vals, gi) => {
      const arr = vals.get(key);
      if (!covered(gi, arr)) return [];
      const b = new Array<number>(PROP_BINS).fill(0);
      for (const v of arr!) {
        let bi = Math.floor(((v - min) / (max - min)) * PROP_BINS);
        if (bi < 0) bi = 0;
        if (bi >= PROP_BINS) bi = PROP_BINS - 1;
        b[bi]++;
      }
      const mx = Math.max(...b, 1);
      return b.map((x) => x / mx);
    });
    out.push({ key, min, max, bins });
  }
  // Properties shared by the most sets first, then alphabetical.
  out.sort(
    (a, b) =>
      b.bins.filter((x) => x.length).length - a.bins.filter((x) => x.length).length ||
      a.key.localeCompare(b.key),
  );
  return out.slice(0, 12);
}

const LIST_KEY = 'comparisons:v1';
const resultKey = (id: string) => `comparison:result:${id}`;

export async function loadComparisons(): Promise<Comparison[]> {
  return (await pcGet<Comparison[]>(LIST_KEY)) ?? [];
}
export async function persistComparisons(list: Comparison[]): Promise<void> {
  await pcSet(LIST_KEY, list);
}
export async function loadResult(id: string): Promise<CmpResult | null> {
  return pcGet<CmpResult>(resultKey(id));
}
export async function persistResult(id: string, r: CmpResult): Promise<void> {
  await pcSet(resultKey(id), r);
}
export async function deleteResult(id: string): Promise<void> {
  await pcDelete(resultKey(id));
}

/** Effective sample count for a source's sampling mode. */
export function samplingCount(s: Sampling, backend: 'memory' | 'duckdb'): number {
  if (s === 'auto') return AUTO_SAMPLE;
  if (s === 'all') return backend === 'duckdb' ? DB_ALL_CAP : Infinity;
  return s;
}

/** Mean nearest-neighbour Tanimoto of each vector in A to the set B. */
function meanNN(A: number[][], B: number[][], sameSet: boolean): number {
  if (A.length === 0 || B.length === 0) return NaN;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < A.length; i++) {
    let best = -1;
    for (let j = 0; j < B.length; j++) {
      if (sameSet && i === j) continue;
      const s = 1 - tanimotoDistanceWords(A[i], B[j]);
      if (s > best) best = s;
    }
    if (best >= 0) {
      sum += best;
      n++;
    }
  }
  return n ? sum / n : NaN;
}

/**
 * Compute a comparison: resolve every source to its sampled compounds (via the
 * injected `sampleSource`), run one shared Morgan/Tanimoto UMAP over the union
 * in the worker, and build the per-set-coloured map + cross-similarity matrix.
 */
export async function computeComparison(
  cmp: Comparison,
  sampleSource: (src: CmpSource) => Promise<Compound[]>,
  onProgress: (frac: number) => void,
): Promise<CmpResult> {
  const groups: { src: CmpSource; compounds: Compound[] }[] = [];
  for (const src of cmp.sources) {
    const compounds = await sampleSource(src);
    if (compounds.length) groups.push({ src, compounds });
  }
  if (groups.length === 0) throw new Error('No valid structures in the selected sets.');

  const unionSmiles: string[] = [];
  const sourceOfIdx: number[] = [];
  groups.forEach((g, gi) =>
    g.compounds.forEach((c) => {
      unionSmiles.push(c.smiles);
      sourceOfIdx.push(gi);
    }),
  );

  const A = resolveAnalyses(cmp);
  // Descriptors feed PCA / metrics / property fallback / ECDF / bivariate /
  // rings / QED; the layout (UMAP) is skipped when the map isn't wanted.
  const withDesc =
    A.pca || A.metrics || A.properties || A.ecdf || A.bivariate || A.rings || A.qed;
  // SMARTS panels for functional-group / structural-alert matching (worker).
  // QED also needs the alert count, so the alert panel runs when QED is on.
  const fgPanel = A.funcGroups ? FUNCTIONAL_GROUPS : [];
  const alertPanel = A.alerts || A.qed ? STRUCTURAL_ALERTS : [];
  const panels = [...fgPanel, ...alertPanel];

  const simScale = A.shape ? 0.5 : 1;
  const { promise } = simRequest(unionSmiles, (frac) => onProgress(frac * simScale), {
    withDescriptors: withDesc,
    withLayout: A.map,
    smarts: panels.length ? panels.map((p) => p.smarts) : undefined,
  });
  const wire = await promise;

  const points: CmpPoint[] = A.map
    ? wire.points.map((p, i) => {
        const gi = sourceOfIdx[wire.keep[i]];
        return { x: p.x, y: p.y, color: groups[gi].src.color, label: groups[gi].src.label };
      })
    : [];

  const vecs: number[][][] = groups.map(() => []);
  const descs: number[][][] = groups.map(() => []);
  wire.keep.forEach((k, i) => {
    const gi = sourceOfIdx[k];
    vecs[gi].push(wire.vectors[i]);
    descs[gi].push(wire.descriptors?.[i] ?? []);
  });
  const keys = wire.descriptorKeys ?? [];

  // Internal similarity is cheap and drives the "diversity" readout, so always
  // compute it even when the full cross-similarity matrix is disabled.
  const internal = vecs.map((V) => meanNN(V, V, true));
  const matrix = A.crossSim
    ? vecs.map((X, a) => vecs.map((Y, b) => meanNN(X, Y, a === b)))
    : undefined;
  const overlap = A.overlap ? overlapMatrix(vecs) : undefined;
  const nnsim = A.nnsim
    ? { key: 'NN Tanimoto', min: 0, max: 1, bins: nnDistribution(vecs) }
    : undefined;
  const spaceOverlap = A.spaceOverlap ? overlapMatrix(vecs, 0.55) : undefined;
  const clusters = A.clusters
    ? butinaClusters(vecs).map((c, gi) => ({
        label: groups[gi].src.label,
        color: groups[gi].src.color,
        clusters: c.clusters,
        singletons: c.singletons,
      }))
    : undefined;
  const ecdf = A.ecdf ? descriptorEcdf(descs, keys) : undefined;
  const bivariate = A.bivariate ? bivariateScatter(groups, descs, keys) : undefined;
  const metrics = A.metrics ? setMetrics(vecs, descs, keys) : undefined;
  const radar = A.metrics
    ? groups.map((g, gi) => ({
        label: g.src.label,
        color: g.src.color,
        means: RADAR_AXES.map((ax) => meanDesc(descs[gi], keys, ax.key)),
      }))
    : undefined;
  const rings = A.rings
    ? groups.map((g, gi) => ({
        label: g.src.label,
        color: g.src.color,
        means: RING_COLS.map((col) => meanDesc(descs[gi], keys, col.key)),
      }))
    : undefined;

  // Functional-group / structural-alert hit rates per set (from SMARTS hits).
  let funcGroups: SmartsRates | undefined;
  let alerts: (SmartsRates & { anyRate: number[] }) | undefined;
  if (wire.smartsHits && panels.length) {
    const hitsByGroup: number[][][] = groups.map(() => []);
    wire.keep.forEach((k, i) => hitsByGroup[sourceOfIdx[k]].push(wire.smartsHits![i]));
    const setLabels = groups.map((g) => g.src.label);
    const setColors = groups.map((g) => g.src.color);
    const rateFor = (colStart: number, pats: typeof panels) =>
      pats.map((p, pi) => ({
        label: p.label,
        fractions: hitsByGroup.map((H) =>
          H.length ? H.reduce((s, h) => s + (h[colStart + pi] || 0), 0) / H.length : NaN,
        ),
      }));
    if (fgPanel.length) funcGroups = { setLabels, setColors, rows: rateFor(0, fgPanel) };
    if (alertPanel.length) {
      const off = fgPanel.length;
      const anyRate = hitsByGroup.map((H) =>
        H.length
          ? H.reduce((s, h) => {
              let any = 0;
              for (let c = 0; c < alertPanel.length; c++)
                if (h[off + c]) {
                  any = 1;
                  break;
                }
              return s + any;
            }, 0) / H.length
          : NaN,
      );
      alerts = { setLabels, setColors, anyRate, rows: rateFor(off, alertPanel) };
    }
  }

  // QED (Bickerton weighted drug-likeness), mean per set.
  let qedResult: { label: string; color: string; mean: number }[] | undefined;
  if (A.qed) {
    const qk = ['amw', 'CrippenClogP', 'NumHBA', 'NumHBD', 'tpsa', 'NumRotatableBonds', 'NumAromaticRings'];
    const qi = qk.map((k) => keys.indexOf(k));
    const alertOff = fgPanel.length;
    const alertN = alertPanel.length;
    const sums = groups.map(() => ({ sum: 0, n: 0 }));
    if (!qi.some((i) => i < 0)) {
      wire.keep.forEach((k, i) => {
        const dv = wire.descriptors?.[i];
        if (!dv) return;
        const vals = qi.map((idx) => dv[idx]);
        if (vals.some((v) => !Number.isFinite(v))) return;
        let nAlerts = 0;
        if (wire.smartsHits && alertN) {
          for (let c = 0; c < alertN; c++) nAlerts += wire.smartsHits[i][alertOff + c] || 0;
        }
        const q = qed([...vals, nAlerts]);
        const gi = sourceOfIdx[k];
        sums[gi].sum += q;
        sums[gi].n++;
      });
    }
    qedResult = groups.map((g, gi) => ({
      label: g.src.label,
      color: g.src.color,
      mean: sums[gi].n ? sums[gi].sum / sums[gi].n : NaN,
    }));
  }
  const pca = A.pca
    ? descriptorPCA(
        groups.map((g, gi) => ({ descs: descs[gi], color: g.src.color })),
        keys,
      )
    : undefined;

  let properties: PropOverlay[] = [];
  if (A.properties) {
    // Prefer the libraries' own numeric columns; fall back to descriptors.
    properties = buildProperties(groups);
    if (properties.length === 0) properties = descriptorOverlays(descs, keys);
  }

  // Optional 3D-shape overlay: a conformer per compound (capped — it's slow).
  let pmi: PmiOverlay | undefined;
  if (A.shape) {
    const CAP = 80;
    const pmiSmiles: string[] = [];
    const pmiSrc: number[] = [];
    groups.forEach((g, gi) => {
      for (let i = 0; i < Math.min(CAP, g.compounds.length); i++) {
        pmiSmiles.push(g.compounds[i].smiles);
        pmiSrc.push(gi);
      }
    });
    const { promise: pmiPromise } = pmiRequest(pmiSmiles, (frac) =>
      onProgress(0.5 + frac * 0.5),
    );
    const nprs = await pmiPromise;
    const pts: PmiOverlay['points'] = [];
    nprs.forEach((npr, i) => {
      if (npr) pts.push({ npr1: npr.npr1, npr2: npr.npr2, color: groups[pmiSrc[i]].src.color });
    });
    pmi = { points: pts };
  }

  return {
    points,
    groups: groups.map((g, gi) => ({
      label: g.src.label,
      color: g.src.color,
      count: g.compounds.length,
      internalSim: internal[gi],
    })),
    matrix,
    properties,
    overlap,
    metrics,
    radar,
    pca,
    nnsim,
    spaceOverlap,
    clusters,
    ecdf,
    bivariate,
    rings,
    funcGroups,
    alerts,
    qed: qedResult,
    pmi,
  };
}
