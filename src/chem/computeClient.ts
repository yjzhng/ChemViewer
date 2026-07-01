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

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./computeWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent) => {
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
      const err = new Error(e.message || 'compute worker crashed');
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

/** Similarity map (fingerprints + UMAP). Returns a job id for cancellation. */
export function simRequest(smiles: string[], onProgress?: Progress) {
  return send<SimWire>('sim', { smiles }, onProgress);
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
