/**
 * Classical MDS (principal coordinates) to lay out a similarity matrix in 2D.
 *
 * Distance = 1 − Tanimoto. We double-centre the squared-distance matrix and
 * take its top-2 eigenvectors via power iteration with deflation. Intended for
 * small samples (≤ ~500 points), where the O(n²·iters) cost is negligible.
 */
/** Parameters to project a NEW point into an existing MDS layout (Gower). */
export interface MdsParams {
  v1: Float64Array;
  l1: number;
  v2: Float64Array;
  l2: number;
  rowMean: Float64Array;
}

export interface Embedding2D {
  x: number[];
  y: number[];
  params: MdsParams;
}

const EMPTY_PARAMS: MdsParams = {
  v1: new Float64Array(0),
  l1: 0,
  v2: new Float64Array(0),
  l2: 0,
  rowMean: new Float64Array(0),
};

/**
 * Place a new point given its squared distances to the sample points
 * (Gower interpolation): xₖ = (1 / 2√λₖ) · Σᵢ vₖᵢ (rowMeanᵢ − d²ᵢ).
 */
export function projectOutOfSample(
  p: MdsParams,
  sqDist: number[],
): { x: number; y: number } {
  let a1 = 0;
  let a2 = 0;
  for (let i = 0; i < sqDist.length; i++) {
    const diff = p.rowMean[i] - sqDist[i];
    a1 += p.v1[i] * diff;
    a2 += p.v2[i] * diff;
  }
  const s1 = p.l1 > 0 ? 2 * Math.sqrt(p.l1) : 0;
  const s2 = p.l2 > 0 ? 2 * Math.sqrt(p.l2) : 0;
  return { x: s1 ? a1 / s1 : 0, y: s2 ? a2 / s2 : 0 };
}

function multiply(B: Float64Array, v: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = i * n;
    for (let j = 0; j < n; j++) s += B[row + j] * v[j];
    out[i] = s;
  }
  return out;
}

function topEigen(
  B: Float64Array,
  n: number,
  iters = 120,
): { value: number; vector: Float64Array } {
  // Deterministic, non-degenerate initial vector.
  let v: Float64Array = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.cos(i * 0.7) + 0.3;

  let value = 0;
  for (let it = 0; it < iters; it++) {
    const w = multiply(B, v, n);
    let norm = 0;
    for (let i = 0; i < n; i++) norm += w[i] * w[i];
    norm = Math.sqrt(norm);
    if (norm < 1e-12) break;
    for (let i = 0; i < n; i++) w[i] /= norm;
    value = norm;
    v = w;
  }
  return { value, vector: v };
}

export function classicalMDS(sim: Float32Array, n: number): Embedding2D {
  if (n === 0) return { x: [], y: [], params: EMPTY_PARAMS };
  if (n === 1) return { x: [0], y: [0], params: EMPTY_PARAMS };

  // Squared distances.
  const D2 = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const d = 1 - sim[i];
    D2[i] = d * d;
  }

  // Double centering: B = -1/2 J D2 J.
  const rowMean = new Float64Array(n);
  let grand = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += D2[i * n + j];
    rowMean[i] = s / n;
    grand += s;
  }
  grand /= n * n;

  const B = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      B[i * n + j] = -0.5 * (D2[i * n + j] - rowMean[i] - rowMean[j] + grand);
    }
  }

  const e1 = topEigen(B, n);
  // Deflate and extract the second component.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      B[i * n + j] -= e1.value * e1.vector[i] * e1.vector[j];
    }
  }
  const e2 = topEigen(B, n);

  const s1 = Math.sqrt(Math.max(e1.value, 0));
  const s2 = Math.sqrt(Math.max(e2.value, 0));
  return {
    x: Array.from(e1.vector, (v) => v * s1),
    y: Array.from(e2.vector, (v) => v * s2),
    params: {
      v1: e1.vector,
      l1: e1.value,
      v2: e2.vector,
      l2: e2.value,
      rowMean,
    },
  };
}
