/**
 * Shared, persistent precompute for the two expensive per-library artifacts:
 *
 *  - the similarity map (Morgan fingerprints → Tanimoto → 2D UMAP layout), and
 *  - the PMI shape plot (3D conformer per compound → NPR1/NPR2).
 *
 * Results are cached three ways, cheapest first:
 *   1. an in-memory Map (instant within a session),
 *   2. IndexedDB (survives across sessions — the launch screen fills this),
 *   3. computed on demand and written back to both.
 *
 * `ensureSim` / `ensurePMI` are the single entry point used by the stats panels
 * AND the launch precompute screen, so a given library-view is only ever
 * computed once regardless of who asks first (in-flight promises are shared).
 */
import { tanimotoDistanceWords } from './fingerprints';
import { simRequest, pmiRequest, cancelJob, isCancelled } from './computeClient';
import { sampleIndices } from '../stats/sample';
import { pcGet, pcHas, pcSet, CACHE_VERSION } from '../data/precomputeCache';
import type { NPR } from './pmi';
import type { Compound, Library } from '../data/types';

export const SIM_SAMPLE = 3000;
export const PMI_SAMPLE = 150;

/** Thrown when a compute is abandoned via `shouldStop`; callers ignore it. */
export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

// ---- keys ------------------------------------------------------------------

/**
 * Stable key for a library + filter view. Must match exactly between the stats
 * panels (which read it) and the launch precompute (which writes the unfiltered
 * view), or the persisted result won't be reused. DuckDB libraries have no
 * in-memory substructure state, so their key omits it.
 */
export function statsViewKey(
  library: Pick<Library, 'id' | 'name' | 'backend'>,
  rules: unknown,
  globalSearch: string,
  substructureSmarts: string | null,
): string {
  if (library.backend === 'duckdb') {
    return `${library.name}|${JSON.stringify({ rules, globalSearch })}`;
  }
  return `${library.id}|${JSON.stringify({
    rules,
    globalSearch,
    sub: substructureSmarts,
  })}`;
}

/** The unfiltered ("Full") view key — what the launch screen precomputes. */
export function baseViewKey(
  library: Pick<Library, 'id' | 'name' | 'backend'>,
): string {
  return statsViewKey(library, [], '', null);
}

const simDbKey = (viewKey: string) => `sim:${CACHE_VERSION}:${viewKey}`;
const pmiDbKey = (viewKey: string) => `pmi:${CACHE_VERSION}:${viewKey}`;

// ---- similarity map --------------------------------------------------------

export interface SimPoint {
  x: number;
  y: number;
  id: string;
}
export interface SimResult {
  points: SimPoint[];
  sampled: number;
  /** Project an out-of-sample fingerprint onto the map (nearest neighbour). */
  project: (vec: number[]) => { x: number; y: number } | null;
}
interface SimPersist {
  points: SimPoint[];
  vectors: number[][];
  sampled: number;
}

const simCache = new Map<string, SimResult>();
const simInFlight = new Map<string, Promise<SimResult>>();

/** Nearest-neighbour projector over the sampled fingerprints (Tanimoto). */
function makeProjector(vectors: number[][], points: SimPoint[]) {
  return (vec: number[]): { x: number; y: number } | null => {
    let best = Infinity;
    let bi = -1;
    for (let i = 0; i < vectors.length; i++) {
      const d = tanimotoDistanceWords(vec, vectors[i]);
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    return bi >= 0 ? { x: points[bi].x, y: points[bi].y } : null;
  };
}

function hydrateSim(p: SimPersist): SimResult {
  return {
    points: p.points,
    sampled: p.sampled,
    project: makeProjector(p.vectors, p.points),
  };
}

interface EnsureOptions {
  shouldStop?: () => boolean;
  onProgress?: (frac: number, label: string) => void;
}

type ProgressCb = (frac: number, label: string) => void;

/**
 * Broadcasts compute progress for a view key to every subscriber, so a compute
 * started by one caller (e.g. the launch precompute) still reports progress to
 * a later caller (e.g. the Browse stats panel) that shares its in-flight job.
 * Remembers the last value so a late subscriber gets it immediately.
 */
function makeProgressHub() {
  const subs = new Map<string, Set<ProgressCb>>();
  const last = new Map<string, [number, string]>();
  return {
    sub(key: string, cb?: ProgressCb): () => void {
      if (!cb) return () => {};
      let set = subs.get(key);
      if (!set) subs.set(key, (set = new Set()));
      set.add(cb);
      const l = last.get(key);
      if (l) cb(l[0], l[1]);
      return () => {
        set!.delete(cb);
        if (set!.size === 0) subs.delete(key);
      };
    },
    emit(key: string, frac: number, label: string): void {
      last.set(key, [frac, label]);
      const set = subs.get(key);
      if (set) for (const cb of [...set]) cb(frac, label);
    },
    clear(key: string): void {
      last.delete(key);
    },
  };
}

const simHub = makeProgressHub();
const pmiHub = makeProgressHub();

/**
 * Await a worker job, wiring `shouldStop` to worker cancellation (polled) and
 * translating a cancelled rejection into our `Cancelled` sentinel.
 */
async function runJob<T>(
  job: { id: number; promise: Promise<T> },
  shouldStop?: () => boolean,
): Promise<T> {
  let stopped = false;
  let iv: ReturnType<typeof setInterval> | undefined;
  if (shouldStop) {
    iv = setInterval(() => {
      if (shouldStop()) {
        stopped = true;
        cancelJob(job.id);
        if (iv) clearInterval(iv);
      }
    }, 200);
  }
  try {
    return await job.promise;
  } catch (e) {
    if (stopped || isCancelled(e)) throw new Cancelled();
    throw e;
  } finally {
    if (iv) clearInterval(iv);
  }
}

/** Get the similarity map for a view, computing + persisting on a cache miss. */
export function ensureSim(
  viewKey: string,
  getSample: (n: number) => Promise<Compound[]>,
  opts: EnsureOptions = {},
): Promise<SimResult> {
  const unsub = simHub.sub(viewKey, opts.onProgress);
  const mem = simCache.get(viewKey);
  if (mem) {
    opts.onProgress?.(1, 'done');
    unsub();
    return Promise.resolve(mem);
  }
  const inflight = simInFlight.get(viewKey);
  if (inflight) return inflight.finally(unsub);

  const p = (async (): Promise<SimResult> => {
    const stored = await pcGet<SimPersist>(simDbKey(viewKey));
    if (stored) {
      const r = hydrateSim(stored);
      simCache.set(viewKey, r);
      simHub.emit(viewKey, 1, 'done');
      return r;
    }

    simHub.emit(viewKey, 0, 'fingerprints');
    const pool = await getSample(SIM_SAMPLE);
    const idx = sampleIndices(pool.length, SIM_SAMPLE);
    // Fingerprints + UMAP run in the worker (off the UI thread).
    const wire = await runJob(
      simRequest(
        idx.map((i) => pool[i].smiles),
        (frac, phase) => simHub.emit(viewKey, frac, phase),
      ),
      opts.shouldStop,
    );

    const points: SimPoint[] = wire.points.map((xy, i) => ({
      x: xy.x,
      y: xy.y,
      id: pool[idx[wire.keep[i]]].id,
    }));
    const persist: SimPersist = {
      points,
      vectors: wire.vectors,
      sampled: wire.sampled,
    };
    await pcSet(simDbKey(viewKey), persist);
    const r = hydrateSim(persist);
    simCache.set(viewKey, r);
    simHub.emit(viewKey, 1, 'done');
    return r;
  })();

  simInFlight.set(viewKey, p);
  return p.finally(() => {
    simInFlight.delete(viewKey);
    simHub.clear(viewKey);
    unsub();
  });
}

// ---- PMI shape -------------------------------------------------------------

export interface PmiPoint {
  npr1: number;
  npr2: number;
  id: string;
}
export interface PmiResult {
  points: PmiPoint[];
  sampled: number;
  byId: Map<string, NPR>;
}
interface PmiPersist {
  points: PmiPoint[];
  sampled: number;
}

const pmiCache = new Map<string, PmiResult>();
const pmiInFlight = new Map<string, Promise<PmiResult>>();

function hydratePmi(p: PmiPersist): PmiResult {
  const byId = new Map<string, NPR>();
  for (const pt of p.points) byId.set(pt.id, { npr1: pt.npr1, npr2: pt.npr2 });
  return { points: p.points, sampled: p.sampled, byId };
}

/** Get the PMI shape plot for a view, computing + persisting on a cache miss. */
export function ensurePMI(
  viewKey: string,
  getSample: (n: number) => Promise<Compound[]>,
  opts: EnsureOptions = {},
): Promise<PmiResult> {
  const unsub = pmiHub.sub(viewKey, opts.onProgress);
  const mem = pmiCache.get(viewKey);
  if (mem) {
    opts.onProgress?.(1, 'done');
    unsub();
    return Promise.resolve(mem);
  }
  const inflight = pmiInFlight.get(viewKey);
  if (inflight) return inflight.finally(unsub);

  const p = (async (): Promise<PmiResult> => {
    const stored = await pcGet<PmiPersist>(pmiDbKey(viewKey));
    if (stored) {
      const r = hydratePmi(stored);
      pmiCache.set(viewKey, r);
      pmiHub.emit(viewKey, 1, 'done');
      return r;
    }

    pmiHub.emit(viewKey, 0, '3D conformers');
    const pool = await getSample(PMI_SAMPLE);
    const idx = sampleIndices(pool.length, PMI_SAMPLE);
    // 3D conformer generation runs in the worker (off the UI thread).
    const nprs = await runJob(
      pmiRequest(
        idx.map((i) => pool[i].smiles),
        (frac, phase) => pmiHub.emit(viewKey, frac, phase),
      ),
      opts.shouldStop,
    );

    const points: PmiPoint[] = [];
    nprs.forEach((npr, k) => {
      if (npr) points.push({ npr1: npr.npr1, npr2: npr.npr2, id: pool[idx[k]].id });
    });
    if (points.length < 1) throw new Error('Could not generate 3D conformers.');

    const persist: PmiPersist = { points, sampled: points.length };
    await pcSet(pmiDbKey(viewKey), persist);
    const r = hydratePmi(persist);
    pmiCache.set(viewKey, r);
    pmiHub.emit(viewKey, 1, 'done');
    return r;
  })();

  pmiInFlight.set(viewKey, p);
  return p.finally(() => {
    pmiInFlight.delete(viewKey);
    pmiHub.clear(viewKey);
    unsub();
  });
}

// ---- launch-screen helpers -------------------------------------------------

/** Whether the persisted sim + PMI artifacts already exist for a base view. */
export async function precomputeStatus(
  viewKey: string,
): Promise<{ sim: boolean; pmi: boolean }> {
  const [sim, pmi] = await Promise.all([
    simCache.has(viewKey) || pcHas(simDbKey(viewKey)),
    pmiCache.has(viewKey) || pcHas(pmiDbKey(viewKey)),
  ]);
  return { sim, pmi };
}
