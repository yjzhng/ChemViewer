/**
 * Taylor–Butina clustering over fingerprints.
 *
 * Standard cheminformatics clustering: build neighbour lists at a similarity
 * cutoff, then greedily seed clusters from the most-connected molecules. O(n²),
 * so callers should pass a sample (a few hundred) rather than a whole library.
 */
import { tanimoto, type Fingerprint } from './fingerprints';

export interface ClusterResult {
  /** Cluster id per input fingerprint (0-based, dense). */
  labels: number[];
  /** Member indices for each cluster, largest first. */
  clusters: number[][];
  /** Lower-triangular distance source: full similarity matrix (n×n). */
  similarity: Float32Array;
  n: number;
}

/** Compute the dense n×n Tanimoto similarity matrix. */
export function similarityMatrix(fps: Fingerprint[]): Float32Array {
  const n = fps.length;
  const sim = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    sim[i * n + i] = 1;
    for (let j = i + 1; j < n; j++) {
      const s = tanimoto(fps[i], fps[j]);
      sim[i * n + j] = s;
      sim[j * n + i] = s;
    }
  }
  return sim;
}

export function butina(
  fps: Fingerprint[],
  cutoff = 0.65,
  sim?: Float32Array,
): ClusterResult {
  const n = fps.length;
  const similarity = sim ?? similarityMatrix(fps);

  // Neighbour list per point at the similarity cutoff.
  const neighbours: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (similarity[i * n + j] >= cutoff) {
        neighbours[i].push(j);
        neighbours[j].push(i);
      }
    }
  }

  // Seed from the densest points first.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => neighbours[b].length - neighbours[a].length,
  );

  const labels = new Array<number>(n).fill(-1);
  const clusters: number[][] = [];
  for (const seed of order) {
    if (labels[seed] !== -1) continue;
    const id = clusters.length;
    const members = [seed];
    labels[seed] = id;
    for (const nb of neighbours[seed]) {
      if (labels[nb] === -1) {
        labels[nb] = id;
        members.push(nb);
      }
    }
    clusters.push(members);
  }

  clusters.sort((a, b) => b.length - a.length);
  // Relabel densely by sorted cluster order.
  clusters.forEach((members, id) => members.forEach((m) => (labels[m] = id)));

  return { labels, clusters, similarity, n };
}
