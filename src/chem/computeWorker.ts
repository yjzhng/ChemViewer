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

interface RDKitQMol {
  is_valid(): boolean;
  delete(): void;
}
interface RDKitLike {
  get_mol(smiles: string): {
    is_valid(): boolean;
    get_morgan_fp(options: string): string;
    get_descriptors(): string;
    get_substruct_match(q: RDKitQMol): string;
    delete(): void;
  } | null;
  get_qmol(smarts: string): RDKitQMol | null;
}

/** True if `mol` contains the SMARTS query `q`. */
function matchesSmarts(
  mol: { get_substruct_match(q: RDKitQMol): string } | null,
  q: RDKitQMol | null,
): number {
  if (!mol || !q) return 0;
  try {
    const j = JSON.parse(mol.get_substruct_match(q)) as { atoms?: number[] };
    return Array.isArray(j.atoms) && j.atoms.length > 0 ? 1 : 0;
  } catch {
    return 0;
  }
}

// Descriptors returned alongside fingerprints (RDKit get_descriptors keys).
export const DESC_KEYS = [
  'amw',
  'CrippenClogP',
  'tpsa',
  'NumHBD',
  'NumHBA',
  'NumRotatableBonds',
  'NumAromaticRings',
  'FractionCSP3',
  'NumRings',
  'NumAliphaticRings',
  'NumAromaticHeterocycles',
  'NumAtomStereoCenters',
];

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

interface Features {
  fp: number[] | null;
  desc: number[] | null;
}
// Fingerprints and descriptors are cached separately: descriptors cost ~3× a
// fingerprint (RDKit get_descriptors), so they're only computed when a caller
// asks for them (comparisons) — never for the per-library similarity map.
const fpCache = new Map<string, number[] | null>();
const descCache = new Map<string, number[] | null>();
const cancelled = new Set<number>();

function extractDesc(json: string): number[] | null {
  try {
    const j = JSON.parse(json) as Record<string, number>;
    return DESC_KEYS.map((k) =>
      typeof j[k] === 'number' && Number.isFinite(j[k]) ? j[k] : NaN,
    );
  } catch {
    return null;
  }
}

/** Morgan fingerprint (+ descriptors when `withDesc`) per SMILES, cached. */
async function featureBatch(
  smiles: string[],
  id: number,
  withDesc: boolean,
  onProgress: (frac: number) => void,
): Promise<Features[] | null> {
  const rdkit = await getRDKit();
  const out: Features[] = [];
  for (let i = 0; i < smiles.length; i++) {
    if (cancelled.has(id)) return null;
    const s = smiles[i];
    let fp = fpCache.get(s);
    let desc = withDesc ? descCache.get(s) : null;
    if (fp === undefined || (withDesc && desc === undefined)) {
      const mol = rdkit.get_mol(s);
      const valid = !!(mol && mol.is_valid());
      try {
        if (fp === undefined) {
          fp = valid ? packBitString(mol!.get_morgan_fp(FP_OPTIONS)) : null;
          fpCache.set(s, fp);
        }
        if (withDesc && desc === undefined) {
          try {
            desc = valid ? extractDesc(mol!.get_descriptors()) : null;
          } catch {
            desc = null; // descriptors unavailable — fingerprints still work
          }
          descCache.set(s, desc);
        }
      } finally {
        mol?.delete();
      }
    }
    out.push({ fp: fp ?? null, desc: desc ?? null });
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
      const withDesc = !!(d as { withDescriptors?: boolean }).withDescriptors;
      const withLayout = (d as { withLayout?: boolean }).withLayout !== false;
      const feats = await featureBatch(smiles, id, withDesc, (frac) =>
        post({ type: 'progress', id, frac: frac * 0.85, phase: 'fingerprints' }),
      );
      if (feats === null || cancelled.has(id)) return post({ type: 'cancelled', id });

      const vectors: number[][] = [];
      const keep: number[] = [];
      const descriptors: number[][] = [];
      for (let k = 0; k < feats.length; k++) {
        const f = feats[k];
        if (f.fp) {
          vectors.push(f.fp);
          keep.push(k);
          descriptors.push(f.desc ?? []);
        }
      }
      if (vectors.length < 5) {
        return post({ type: 'error', id, message: 'Too few valid structures to map.' });
      }

      let points: { x: number; y: number }[] = [];
      if (withLayout) {
        post({ type: 'progress', id, frac: 0.88, phase: 'layout' });
        const umap = new UMAP({
          nComponents: 2,
          nNeighbors: Math.min(15, vectors.length - 1),
          minDist: 0.1,
          distanceFn: tanimotoDistanceWords,
          random: seededRandom(42),
        });
        // Heartbeat each epoch so the main-thread watchdog doesn't mistake a long
        // (but healthy) layout for a stall.
        let epoch = 0;
        const embedding = await umap.fitAsync(vectors, () => {
          if (epoch++ % 20 === 0) post({ type: 'progress', id, frac: 0.9, phase: 'layout' });
        });
        if (cancelled.has(id)) return post({ type: 'cancelled', id });
        points = embedding.map((xy) => ({ x: xy[0], y: xy[1] }));
      }

      // Optional SMARTS-panel matching (functional groups / structural alerts):
      // one 0/1 vector per kept compound, aligned to `keep`.
      let smartsHits: number[][] | undefined;
      const smarts = (d as { smarts?: string[] }).smarts;
      if (smarts && smarts.length) {
        post({ type: 'progress', id, frac: 0.95, phase: 'substructure' });
        const rdkit = await getRDKit();
        const qmols = smarts.map((s) => rdkit.get_qmol(s));
        smartsHits = [];
        for (const k of keep) {
          if (cancelled.has(id)) {
            qmols.forEach((q) => q?.delete());
            return post({ type: 'cancelled', id });
          }
          const mol = rdkit.get_mol(smiles[k]);
          smartsHits.push(qmols.map((q) => matchesSmarts(mol, q)));
          mol?.delete();
        }
        qmols.forEach((q) => q?.delete());
      }

      post({
        type: 'done',
        id,
        result: {
          points,
          keep,
          vectors,
          descriptors,
          descriptorKeys: DESC_KEYS,
          smartsHits,
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
