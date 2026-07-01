/**
 * Dedicated compute worker — keeps the expensive chemistry off the UI thread.
 *
 * Handles the two heavy batch jobs (similarity map: fingerprints + UMAP; and
 * PMI: 3D conformers → NPR) plus single-molecule hover lookups. Running them
 * here means the main thread stays responsive during a compute, and because
 * there is exactly ONE worker the load is capped at a single background core —
 * it never fights the UI (or the rest of the machine) for CPU.
 *
 * RDKit is loaded independently here (the main thread has its own copy for
 * structure rendering); OpenChemLib and UMAP are bundled into this worker.
 */
import { UMAP } from 'umap-js';
import { computeNPRBatch, computeNPR } from './pmi';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (m: unknown) => void;
  initRDKitModule?: (opts?: {
    locateFile?: (f: string) => string;
  }) => Promise<RDKitLike>;
};

interface RDKitLike {
  get_mol(smiles: string): {
    is_valid(): boolean;
    get_morgan_fp(options: string): string;
    delete(): void;
  } | null;
}

// ---- fingerprint math (kept local so the worker needn't import DOM code) ----
const FP_BITS = 1024;
const WORDS = FP_BITS / 32;
const FP_OPTIONS = JSON.stringify({ radius: 2, nBits: FP_BITS });

function packBitString(bits: string): number[] {
  const out = new Array<number>(WORDS).fill(0);
  for (let i = 0; i < bits.length && i < FP_BITS; i++) {
    if (bits.charCodeAt(i) === 49 /* '1' */) out[i >>> 5] |= 1 << (i & 31);
  }
  return out;
}

function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

function tanimotoDistanceWords(a: number[], b: number[]): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    inter += popcount(a[i] & b[i]);
    union += popcount(a[i] | b[i]);
  }
  return union === 0 ? 1 : 1 - inter / union;
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---- RDKit (worker-local, loaded from the same /rdkit/ assets) --------------
let rdkitPromise: Promise<RDKitLike> | null = null;
function getRDKit(): Promise<RDKitLike> {
  if (!rdkitPromise) {
    rdkitPromise = (async () => {
      // The glue script is a classic script that defines a global initializer;
      // fetch + indirect-eval installs it on the worker global scope.
      const src = await (await fetch('/rdkit/RDKit_minimal.js')).text();
      (0, eval)(src);
      return ctx.initRDKitModule!({ locateFile: (f) => `/rdkit/${f}` });
    })();
  }
  return rdkitPromise;
}

const fpCache = new Map<string, number[] | null>();
const cancelled = new Set<number>();

async function fingerprintBatch(
  smiles: string[],
  id: number,
  onProgress: (frac: number) => void,
): Promise<(number[] | null)[] | null> {
  const rdkit = await getRDKit();
  const out: (number[] | null)[] = [];
  for (let i = 0; i < smiles.length; i++) {
    if (cancelled.has(id)) return null;
    const s = smiles[i];
    let v = fpCache.get(s);
    if (v === undefined) {
      const mol = rdkit.get_mol(s);
      let fp: number[] | null = null;
      try {
        if (mol && mol.is_valid()) fp = packBitString(mol.get_morgan_fp(FP_OPTIONS));
      } finally {
        mol?.delete();
      }
      fpCache.set(s, fp);
      v = fp;
    }
    out.push(v);
    if ((i & 511) === 511) {
      onProgress((i + 1) / smiles.length);
      await new Promise((r) => setTimeout(r));
    }
  }
  return out;
}

function post(m: unknown) {
  ctx.postMessage(m);
}

ctx.onmessage = async (e: MessageEvent) => {
  const d = e.data as {
    kind: string;
    id: number;
    smiles?: string[] | string;
  };
  if (d.kind === 'cancel') {
    cancelled.add(d.id);
    return;
  }
  const id = d.id;
  try {
    if (d.kind === 'sim') {
      const smiles = d.smiles as string[];
      const fps = await fingerprintBatch(smiles, id, (frac) =>
        post({ type: 'progress', id, frac: frac * 0.85, phase: 'fingerprints' }),
      );
      if (fps === null || cancelled.has(id)) return post({ type: 'cancelled', id });

      const vectors: number[][] = [];
      const keep: number[] = [];
      for (let k = 0; k < fps.length; k++) {
        const fp = fps[k];
        if (fp) {
          vectors.push(fp);
          keep.push(k);
        }
      }
      if (vectors.length < 5) {
        return post({ type: 'error', id, message: 'Too few valid structures to map.' });
      }

      post({ type: 'progress', id, frac: 0.88, phase: 'layout' });
      const umap = new UMAP({
        nComponents: 2,
        nNeighbors: Math.min(15, vectors.length - 1),
        minDist: 0.1,
        distanceFn: tanimotoDistanceWords,
        random: seededRandom(42),
      });
      const embedding = await umap.fitAsync(vectors);
      if (cancelled.has(id)) return post({ type: 'cancelled', id });

      post({
        type: 'done',
        id,
        result: {
          points: embedding.map((xy) => ({ x: xy[0], y: xy[1] })),
          keep,
          vectors,
          sampled: vectors.length,
        },
      });
    } else if (d.kind === 'pmi') {
      const smiles = d.smiles as string[];
      const nprs = await computeNPRBatch(smiles, {
        shouldStop: () => cancelled.has(id),
        onProgress: (done, total) =>
          post({ type: 'progress', id, frac: total ? done / total : 0, phase: '3D' }),
      });
      if (cancelled.has(id)) return post({ type: 'cancelled', id });
      post({ type: 'done', id, result: nprs });
    } else if (d.kind === 'nprOne') {
      const npr = await computeNPR(d.smiles as string);
      post({ type: 'done', id, result: npr });
    }
  } catch (err) {
    post({ type: 'error', id, message: String((err as Error)?.message ?? err) });
  } finally {
    cancelled.delete(id);
  }
};
