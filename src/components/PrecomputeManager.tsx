import { useEffect, useRef } from 'react';
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
  const libraryLoading = useStore((s) => s.libraryLoading);
  const setLibStatus = useStore((s) => s.setLibStatus);
  const cacheLibrary = useStore((s) => s.cacheLibrary);
  const started = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (started.current || libraryLoading || manifest.length === 0) return;
    started.current = true;

    (async () => {
      // Seed each library's status from what's already cached on disk.
      const preReady: boolean[] = await Promise.all(
        manifest.map(async (e) => {
          const s = await precomputeStatus(
            baseViewKey({ id: e.name, name: e.name, backend: e.backend }),
          );
          setLibStatus(e.name, {
            sim: s.sim ? 1 : 0,
            pmi: s.pmi ? 1 : 0,
            state: s.sim && s.pmi ? 'ready' : 'queued',
          });
          return s.sim && s.pmi;
        }),
      );

      // Precompute the rest, one library at a time.
      for (let i = 0; i < manifest.length; i++) {
        if (cancelled.current) return;
        if (preReady[i]) continue;

        const entry = manifest[i];
        const key = baseViewKey({
          id: entry.name,
          name: entry.name,
          backend: entry.backend,
        });
        const { cache } = useStore.getState();

        let getSample: (n: number) => Promise<Compound[]>;
        try {
          if (entry.backend === 'duckdb') {
            getSample = (n) =>
              dbSample(entry.name, { rules: [], globalSearch: '' }, n);
          } else {
            setLibStatus(entry.name, { state: 'loading' });
            const lib = cache[entry.name] ?? (await loadLibraryFromManifest(entry));
            if (!cache[entry.name]) cacheLibrary(lib);
            getSample = async () => lib.compounds;
          }
        } catch {
          setLibStatus(entry.name, { state: 'error' });
          continue;
        }
        if (cancelled.current) return;
        setLibStatus(entry.name, { state: 'precomputing' });

        try {
          await ensureSim(key, getSample, {
            shouldStop: () => cancelled.current,
            onProgress: (frac) => setLibStatus(entry.name, { sim: frac }),
          });
          if (cancelled.current) return;
          await ensurePMI(key, getSample, {
            shouldStop: () => cancelled.current,
            onProgress: (frac) => setLibStatus(entry.name, { pmi: frac }),
          });
          setLibStatus(entry.name, { state: 'ready', sim: 1, pmi: 1 });
        } catch (e) {
          if (e instanceof Cancelled) return;
          setLibStatus(entry.name, { state: 'error' });
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, libraryLoading]);

  return null;
}
