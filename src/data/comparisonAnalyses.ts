/**
 * Pure analysis functions over the per-set fingerprint vectors + RDKit
 * descriptor vectors that a comparison already computes. Everything here runs
 * on the main thread from data the worker returned — no extra chemistry passes.
 */
import { tanimotoDistanceWords } from '../chem/fingerprints';

const sim = (a: number[], b: number[]) => 1 - tanimotoDistanceWords(a, b);

/** Max Tanimoto of x to any vector in B (optionally excluding one index). */
function maxSim(x: number[], B: number[][], skip = -1): number {
  let best = 0;
  for (let j = 0; j < B.length; j++) {
    if (j === skip) continue;
    const s = sim(x, B[j]);
    if (s > best) best = s;
  }
  return best;
}

/**
 * Per-set histogram of each compound's nearest-neighbour Tanimoto to the union
 * of the OTHER sets — the continuous distribution behind novelty/overlap.
 * Returns bins[set][bin] normalised to the set's own peak (0..1), over [0,1].
 */
export function nnDistribution(vecs: number[][][], nb = 24): number[][] {
  return vecs.map((A, a) => {
    const others: number[][] = [];
    vecs.forEach((V, b) => {
      if (b !== a) others.push(...V);
    });
    const bins = new Array<number>(nb).fill(0);
    if (A.length === 0 || others.length === 0) return bins;
    for (const x of A) {
      let bi = Math.floor(maxSim(x, others) * nb);
      if (bi >= nb) bi = nb - 1;
      bins[bi]++;
    }
    const mx = Math.max(...bins, 1);
    return bins.map((v) => v / mx);
  });
}

/** Butina (sphere-exclusion) clustering per set → cluster + singleton counts. */
export function butinaClusters(
  vecs: number[][][],
  cutoff = 0.35,
): { clusters: number; singletons: number }[] {
  const simThr = 1 - cutoff;
  return vecs.map((V) => {
    const n = V.length;
    if (n === 0) return { clusters: 0, singletons: 0 };
    const nbr: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (sim(V[i], V[j]) >= simThr) {
          nbr[i].push(j);
          nbr[j].push(i);
        }
      }
    }
    const order = [...Array(n).keys()].sort((a, b) => nbr[b].length - nbr[a].length);
    const assigned = new Array<boolean>(n).fill(false);
    let clusters = 0;
    let singletons = 0;
    for (const c of order) {
      if (assigned[c]) continue;
      assigned[c] = true;
      let size = 1;
      for (const x of nbr[c]) {
        if (!assigned[x]) {
          assigned[x] = true;
          size++;
        }
      }
      clusters++;
      if (size === 1) singletons++;
    }
    return { clusters, singletons };
  });
}

// ---- QED (Bickerton weighted drug-likeness) --------------------------------
// Standard RDKit ADS parameters [A,B,C,D,E,F,DMAX] for
// [MW, ALOGP, HBA, HBD, PSA, ROTB, AROM, ALERTS], with the "mean" weights.
const QED_P: number[][] = [
  [2.817065973, 392.5754953, 290.7489764, -2.419764353, 49.22325677, 65.37051707, 104.9805561],
  [3.172690585, 137.8624751, 2.534937431, 4.581497897, 0.822739142, 0.576295591, 131.3186604],
  [2.948620388, 160.4605972, 3.615294657, 4.435986202, 0.290141953, 1.300669958, 148.7763046],
  [1.618662227, 1010.051101, 0.985094388, 1e-9, 0.713820843, 0.920922555, 258.1632616],
  [1.876861559, 125.2232657, 62.90773554, 87.83366614, 12.01999616, 28.51324732, 104.5686167],
  [0.01, 272.4121427, 2.55837997, 1.565547684, 1.271567166, 2.758063707, 105.4420403],
  [3.21778897, 957.7374608, 2.274627939, 1e-9, 0.59565093, 1e-9, 1199.09436],
  [2.49935796, 300.25374, 218.6768454, 128.6114202, 154.5391184, 4.66254759, 100.5589528],
];
const QED_W = [0.66, 0.46, 0.05, 0.61, 0.06, 0.65, 0.48, 0.95];

function ads(x: number, p: number[]): number {
  const e1 = 1 + Math.exp(-(x - p[2] + p[3] / 2) / p[4]);
  const e2 = 1 + Math.exp(-(x - p[2] - p[3] / 2) / p[5]);
  return (p[0] + (p[1] / e1) * (1 - 1 / e2)) / p[6];
}

/**
 * QED from the 8 inputs [MW, ALOGP, HBA, HBD, PSA, RotB, aromatic rings,
 * #alerts]. Validated against known drugs (aspirin ≈ 0.56, ibuprofen ≈ 0.61).
 */
export function qed(vals: number[]): number {
  let s = 0;
  let sw = 0;
  for (let i = 0; i < 8; i++) {
    const d = Math.min(1, Math.max(1e-9, ads(vals[i], QED_P[i])));
    s += QED_W[i] * Math.log(d);
    sw += QED_W[i];
  }
  return Math.exp(s / sw);
}

export interface SetMetrics {
  /** Fraction novel: nearest neighbour in all OTHER sets below `noveltyThr`. */
  novelty: number;
  /** Fraction passing Lipinski's rule of five (strict, 0 violations). */
  ro5: number;
  /** Fraction passing Veber (RotB ≤ 10 and TPSA ≤ 140). */
  veber: number;
}

/** % of each row set with a near-duplicate (Tanimoto ≥ thr) in each column set. */
export function overlapMatrix(vecs: number[][][], thr = 0.9): number[][] {
  return vecs.map((A, a) =>
    vecs.map((B, b) => {
      if (A.length === 0 || B.length === 0) return NaN;
      let hit = 0;
      for (let i = 0; i < A.length; i++) {
        let found = false;
        for (let j = 0; j < B.length; j++) {
          if (a === b && i === j) continue;
          if (sim(A[i], B[j]) >= thr) {
            found = true;
            break;
          }
        }
        if (found) hit++;
      }
      return hit / A.length;
    }),
  );
}

/** Fraction of each set whose nearest neighbour in all other sets is < thr. */
export function novelty(vecs: number[][][], thr = 0.4): number[] {
  return vecs.map((A, a) => {
    const others: number[][] = [];
    vecs.forEach((V, b) => {
      if (b !== a) others.push(...V);
    });
    if (A.length === 0 || others.length === 0) return NaN;
    let novel = 0;
    for (const x of A) {
      let best = 0;
      for (const y of others) {
        const s = sim(x, y);
        if (s > best) best = s;
      }
      if (best < thr) novel++;
    }
    return novel / A.length;
  });
}

/** Fraction passing Lipinski Ro5 and Veber, from descriptor vectors. */
function druglike(
  D: number[][],
  keys: string[],
): { ro5: number; veber: number } {
  const iMW = keys.indexOf('amw');
  const iLogP = keys.indexOf('CrippenClogP');
  const iHBD = keys.indexOf('NumHBD');
  const iHBA = keys.indexOf('NumHBA');
  const iRotB = keys.indexOf('NumRotatableBonds');
  const iTPSA = keys.indexOf('tpsa');
  let ro5 = 0;
  let veber = 0;
  let n = 0;
  for (const d of D) {
    if (!d.length || d.some((v) => !Number.isFinite(v))) continue;
    n++;
    if (d[iMW] <= 500 && d[iLogP] <= 5 && d[iHBD] <= 5 && d[iHBA] <= 10) ro5++;
    if (d[iRotB] <= 10 && d[iTPSA] <= 140) veber++;
  }
  return n ? { ro5: ro5 / n, veber: veber / n } : { ro5: NaN, veber: NaN };
}

/** Per-set metrics bundle (novelty + drug-likeness). */
export function setMetrics(
  vecs: number[][][],
  descs: number[][][],
  keys: string[],
  opts: { noveltyThr?: number } = {},
): SetMetrics[] {
  const nov = novelty(vecs, opts.noveltyThr ?? 0.4);
  return vecs.map((_, i) => {
    const dl = druglike(descs[i] ?? [], keys);
    return { novelty: nov[i], ro5: dl.ro5, veber: dl.veber };
  });
}

// ---- PCA of descriptor space ----------------------------------------------

/** Eigen-decomposition of a symmetric matrix via cyclic Jacobi rotation. */
function jacobiEigen(input: number[][]): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map((r) => r.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) off += Math.abs(a[p][q]);
    if (off < 1e-10) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-14) continue;
        const phi = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((_, i) => a[i][i]), vectors: v };
}

export interface PcaPoint {
  x: number;
  y: number;
  color: string;
}

/**
 * 2D PCA of the standardized descriptor vectors, coloured per set. Returns null
 * if there aren't enough complete descriptor rows.
 */
export function descriptorPCA(
  groups: { descs: number[][]; color: string }[],
  keys: string[],
): { points: PcaPoint[]; explained: [number, number] } | null {
  const rows: { d: number[]; color: string }[] = [];
  for (const g of groups) {
    for (const d of g.descs) {
      if (d.length === keys.length && d.every((x) => Number.isFinite(x))) {
        rows.push({ d, color: g.color });
      }
    }
  }
  const m = keys.length;
  if (rows.length < 5 || m < 2) return null;

  // Standardize each descriptor column (z-score).
  const mean = new Array(m).fill(0);
  for (const r of rows) for (let j = 0; j < m; j++) mean[j] += r.d[j];
  for (let j = 0; j < m; j++) mean[j] /= rows.length;
  const sd = new Array(m).fill(0);
  for (const r of rows)
    for (let j = 0; j < m; j++) sd[j] += (r.d[j] - mean[j]) ** 2;
  for (let j = 0; j < m; j++) sd[j] = Math.sqrt(sd[j] / rows.length) || 1;
  const Z = rows.map((r) => r.d.map((x, j) => (x - mean[j]) / sd[j]));

  // Covariance matrix, then top-2 eigenvectors.
  const cov: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  for (const z of Z)
    for (let i = 0; i < m; i++)
      for (let j = 0; j < m; j++) cov[i][j] += (z[i] * z[j]) / Z.length;
  const { values, vectors } = jacobiEigen(cov);
  const order = [...Array(m).keys()].sort((a, b) => values[b] - values[a]);
  const e1 = order[0];
  const e2 = order[1];
  const pc1 = vectors.map((row) => row[e1]);
  const pc2 = vectors.map((row) => row[e2]);

  const points = Z.map((z, i) => ({
    x: z.reduce((s, v, j) => s + v * pc1[j], 0),
    y: z.reduce((s, v, j) => s + v * pc2[j], 0),
    color: rows[i].color,
  }));

  // Fraction of total variance captured by each of the top-2 components.
  const total = values.reduce((s, v) => s + Math.max(0, v), 0) || 1;
  const explained: [number, number] = [
    Math.max(0, values[e1]) / total,
    Math.max(0, values[e2]) / total,
  ];
  return { points, explained };
}
