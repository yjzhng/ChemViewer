import { useEffect } from 'react';
import { useStore } from '../data/store';
import { loadLibraryFromManifest } from '../data/loaders/manifest';
import { dbSample } from '../data/dbClient';
import {
  ensureSim,
  ensurePMI,
  baseViewKey,
  precomputeStatus,
  Cancelled,
} from '../chem/precompute';
import type { Compound } from '../data/types';

type Sampler = (n: number) => Promise<Compound[]>;

/**
 * Headless background orchestrator. On startup it precomputes the two expensive
 * artifacts (similarity map + PMI shape) for every detected library, one at a
 * time so the single compute worker is never overloaded, and writes progress
 * into the store. The Library manager view reads that status, and the library
 * selector only offers libraries that have reached "ready" — so switching to a
 * library always lands on precomputed, instantly-rendered data.
 */
export function PrecomputeManager() {
  const manifest = useStore((s) => s.manifest);
  const setLibStatus = useStore((s) => s.setLibStatus);
  const cacheLibrary = useStore((s) => s.cacheLibrary);

  // Depends ONLY on the manifest (stable after the initial scan) — NOT on
  // `libraryLoading`, which toggles when a library opens and would cancel the
  // whole queue. `active` is a per-run flag (not a persistent ref) so React
  // StrictMode's mount→unmount→remount doesn't permanently cancel precompute:
  // the first run stops cleanly and the remount run actually does the work.
  useEffect(() => {
    if (manifest.length === 0) return;
    let active = true;

    // Resolve a library's sampler (parsing memory libs once and caching them).
    const getSampleFor = async (
      entry: (typeof manifest)[number],
    ): Promise<Sampler | null> => {
      if (entry.backend === 'duckdb') {
        return (n) => dbSample(entry.name, { rules: [], globalSearch: '' }, n);
      }
      const { cache } = useStore.getState();
      let lib = cache[entry.name];
      if (!lib) {
        try {
          lib = await loadLibraryFromManifest(entry);
          cacheLibrary(lib);
        } catch {
          return null;
        }
      }
      return async () => lib!.compounds;
    };

    (async () => {
      const key = (e: (typeof manifest)[number]) =>
        baseViewKey({ id: e.name, name: e.name, backend: e.backend });

      // Seed status from what's already cached on disk.
      const seeded = await Promise.all(
        manifest.map(async (e) => {
          const s = await precomputeStatus(key(e));
          setLibStatus(e.name, {
            sim: s.sim ? 1 : 0,
            pmi: s.pmi ? 1 : 0,
            // Ready once the similarity map exists (browsable); PMI can trail.
            state: s.sim ? 'ready' : 'queued',
          });
          return s;
        }),
      );

      // Pass 1 — similarity maps: makes libraries ready/browsable quickly.
      for (let i = 0; i < manifest.length; i++) {
        if (!active) return;
        if (seeded[i].sim) continue;
        const entry = manifest[i];
        setLibStatus(entry.name, { state: 'loading' });
        const getSample = await getSampleFor(entry);
        if (!getSample) {
          setLibStatus(entry.name, { state: 'error' });
          continue;
        }
        if (!active) return;
        setLibStatus(entry.name, { state: 'precomputing' });
        try {
          await ensureSim(key(entry), getSample, {
            shouldStop: () => !active,
            onProgress: (frac) => setLibStatus(entry.name, { sim: frac }),
          });
        } catch (e) {
          if (e instanceof Cancelled) return;
          setLibStatus(entry.name, { state: 'error' });
          continue;
        }
        if (!active) return;
        setLibStatus(entry.name, { state: 'ready', sim: 1 });
      }

      // Pass 2 — PMI (3D shape): best-effort. OpenChemLib can be slow or hang on
      // odd structures, so a failure/stall (caught by the worker watchdog) is
      // ignored and never un-readies a library.
      for (let i = 0; i < manifest.length; i++) {
        if (!active) return;
        if (seeded[i].pmi) continue;
        const entry = manifest[i];
        const getSample = await getSampleFor(entry);
        if (!getSample) continue;
        if (!active) return;
        try {
          await ensurePMI(key(entry), getSample, {
            shouldStop: () => !active,
            onProgress: (frac) => setLibStatus(entry.name, { pmi: frac }),
          });
          setLibStatus(entry.name, { pmi: 1 });
        } catch (e) {
          if (e instanceof Cancelled) return;
          // best-effort — leave PMI progress as-is.
        }
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest]);

  return null;
}
