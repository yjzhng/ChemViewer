/**
 * Main-thread client for the compute worker (see computeWorker.ts). Wraps the
 * postMessage protocol in promises with progress callbacks and cancellation.
 * A single lazily-created worker is shared by every caller, so all heavy work
 * is serialized onto one background core and never floods the CPU.
 */
import type { NPR } from './pmi';

/** Raw similarity-map result from the worker (ids are attached on the main side). */
export interface SimWire {
  points: { x: number; y: number }[];
  /** Indices (into the submitted SMILES) that produced a valid fingerprint. */
  keep: number[];
  vectors: number[][];
  /** Descriptor vector per kept compound (aligned to `keep`/`vectors`). */
  descriptors: number[][];
  descriptorKeys: string[];
  /** SMARTS-panel 0/1 hit vector per kept compound (present when requested). */
  smartsHits?: number[][];
  sampled: number;
}

type Progress = (frac: number, phase: string) => void;
interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  onProgress?: Progress;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

// Watchdog: OpenChemLib's 3D conformer generation can hang (infinite-loop) on
// certain structures, which would freeze the single worker forever. We treat a
// long silence (no progress/completion) while jobs are pending as a stall, kill
// the worker, reject its jobs, and let the next request spin up a fresh one.
const STALL_MS = 20000;
let lastActivity = Date.now();
let watchdog: ReturnType<typeof setInterval> | null = null;

function startWatchdog() {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (pending.size === 0) {
      lastActivity = Date.now();
      return;
    }
    if (Date.now() - lastActivity <= STALL_MS) return;
    const w = worker;
    worker = null;
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
    try {
      w?.terminate();
    } catch {
      /* ignore */
    }
    console.error('[computeWorker] stalled — terminated and will restart');
    const err = Object.assign(
      new Error('compute worker stalled (a molecule likely hung 3D generation) — restarted'),
      { stalled: true },
    );
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  }, 5000);
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./computeWorker.ts', import.meta.url), {
      type: 'module',
    });
    lastActivity = Date.now();
    startWatchdog();
    worker.onmessage = (e: MessageEvent) => {
      lastActivity = Date.now();
      const d = e.data as {
        type: string;
        id: number;
        frac?: number;
        phase?: string;
        result?: unknown;
        message?: string;
      };
      const p = pending.get(d.id);
      if (!p) return;
      if (d.type === 'progress') {
        p.onProgress?.(d.frac ?? 0, d.phase ?? '');
        return;
      }
      pending.delete(d.id);
      if (d.type === 'done') p.resolve(d.result);
      else if (d.type === 'cancelled')
        p.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      else p.reject(new Error(d.message || 'compute failed'));
    };
    worker.onerror = (e) => {
      console.error('[computeWorker] error:', e.message, e.filename, e);
      const err = new Error(
        e.message
          ? `compute worker: ${e.message}`
          : 'compute worker failed to load',
      );
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    };
  }
  return worker;
}

function send<T>(
  kind: string,
  payload: Record<string, unknown>,
  onProgress?: Progress,
): { id: number; promise: Promise<T> } {
  const w = getWorker();
  const id = nextId++;
  const promise = new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
  });
  w.postMessage({ kind, id, ...payload });
  return { id, promise };
}

/**
 * Similarity map (fingerprints + UMAP). Returns a job id for cancellation.
 * `withDescriptors` also computes RDKit descriptors per compound (~3× slower);
 * `withLayout` (default true) runs the UMAP embedding — skip it when only the
 * fingerprint vectors are needed (e.g. matrix/overlap without the map).
 */
export function simRequest(
  smiles: string[],
  onProgress?: Progress,
  opts?: { withDescriptors?: boolean; withLayout?: boolean; smarts?: string[] },
) {
  return send<SimWire>(
    'sim',
    {
      smiles,
      withDescriptors: !!opts?.withDescriptors,
      withLayout: opts?.withLayout !== false,
      smarts: opts?.smarts,
    },
    onProgress,
  );
}

/** PMI batch (3D conformers → NPR), aligned to the input SMILES. */
export function pmiRequest(smiles: string[], onProgress?: Progress) {
  return send<(NPR | null)[]>('pmi', { smiles }, onProgress);
}

/** Single-molecule NPR (PMI hover), off the main thread. */
export function nprOne(smiles: string): Promise<NPR | null> {
  return send<NPR | null>('nprOne', { smiles }).promise;
}

/** Ask the worker to abandon an in-flight job. */
export function cancelJob(id: number): void {
  getWorker().postMessage({ kind: 'cancel', id });
}

/** True if a rejection came from cancellation (vs a real error). */
export function isCancelled(e: unknown): boolean {
  return !!(e as { cancelled?: boolean })?.cancelled;
}
