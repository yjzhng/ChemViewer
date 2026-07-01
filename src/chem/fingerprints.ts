/**
 * Morgan fingerprints + Tanimoto similarity.
 *
 * Fingerprints are stored as packed Uint32Array bit vectors for fast popcount
 * Tanimoto. Used by clustering (stats) and library comparison (Analyse).
 */
import { getRDKit } from './rdkit';

export const FP_BITS = 1024;
const WORDS = FP_BITS / 32;
const FP_OPTIONS = JSON.stringify({ radius: 2, nBits: FP_BITS });

export type Fingerprint = Uint32Array;

function packBitString(bits: string): Fingerprint {
  const out = new Uint32Array(WORDS);
  for (let i = 0; i < bits.length && i < FP_BITS; i++) {
    if (bits.charCodeAt(i) === 49 /* '1' */) {
      out[i >>> 5] |= 1 << (i & 31);
    }
  }
  return out;
}

function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

/** Tanimoto similarity of two packed fingerprints, in [0, 1]. */
export function tanimoto(a: Fingerprint, b: Fingerprint): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < WORDS; i++) {
    inter += popcount(a[i] & b[i]);
    union += popcount(a[i] | b[i]);
  }
  return union === 0 ? 0 : inter / union;
}

// Fingerprints are expensive (RDKit parse per molecule) and the main cost of
// the similarity map, so cache them by SMILES (LRU-ish, capped).
const FP_CACHE_MAX = 200_000;
const fpCache = new Map<string, Fingerprint | null>();

function cacheGet(smiles: string): Fingerprint | null | undefined {
  const v = fpCache.get(smiles);
  if (v !== undefined) {
    fpCache.delete(smiles);
    fpCache.set(smiles, v);
  }
  return v;
}
function cacheSet(smiles: string, fp: Fingerprint | null): void {
  fpCache.set(smiles, fp);
  if (fpCache.size > FP_CACHE_MAX) {
    const oldest = fpCache.keys().next().value;
    if (oldest !== undefined) fpCache.delete(oldest);
  }
}

/** Tanimoto distance (1 − similarity) over plain word arrays — for umap-js. */
export function tanimotoDistanceWords(a: number[], b: number[]): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    inter += popcount(a[i] & b[i]);
    union += popcount(a[i] | b[i]);
  }
  return union === 0 ? 1 : 1 - inter / union;
}

export interface BatchOptions {
  /** Return true to abort early (e.g. the filter/library changed). */
  shouldStop?: () => boolean;
  /** Called periodically with (done, total) so callers can show progress. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Compute Morgan fingerprints for a list of SMILES (cached by SMILES).
 * Returns one entry per input; null where the SMILES failed to parse.
 */
export async function computeFingerprints(
  smilesList: string[],
  opts?: BatchOptions,
): Promise<(Fingerprint | null)[]> {
  const out: (Fingerprint | null)[] = new Array(smilesList.length).fill(null);
  let needRdkit = false;
  for (let i = 0; i < smilesList.length; i++) {
    const hit = cacheGet(smilesList[i]);
    if (hit !== undefined) out[i] = hit;
    else needRdkit = true;
  }
  if (!needRdkit) {
    opts?.onProgress?.(smilesList.length, smilesList.length);
    return out;
  }

  const rdkit = await getRDKit();
  for (let i = 0; i < smilesList.length; i++) {
    if (opts?.shouldStop?.()) break;
    const cached = cacheGet(smilesList[i]);
    if (cached !== undefined) {
      out[i] = cached;
    } else {
      const mol = rdkit.get_mol(smilesList[i]);
      let fp: Fingerprint | null = null;
      try {
        if (mol && mol.is_valid()) fp = packBitString(mol.get_morgan_fp(FP_OPTIONS));
      } finally {
        mol?.delete();
      }
      cacheSet(smilesList[i], fp);
      out[i] = fp;
    }
    // Yield to the event loop so the UI stays responsive during big batches.
    if ((i & 255) === 255) {
      opts?.onProgress?.(i + 1, smilesList.length);
      await new Promise((r) => setTimeout(r));
    }
  }
  opts?.onProgress?.(smilesList.length, smilesList.length);
  return out;
}
