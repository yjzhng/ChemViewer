/**
 * Shared "pick a library or subset" helpers used by Search and the library
 * Author. Mirrors the source list the Analyse page builds inline.
 */
import { useMemo } from 'react';
import { useStore } from './store';
import type { Compound } from './types';
import { materializeSubset } from './sources';
import { loadLibraryFromManifest } from './loaders/manifest';

export interface AvailSource {
  sourceId: string;
  label: string;
  libName: string;
  kind: 'library' | 'subset';
  backend: 'memory' | 'duckdb';
  subsetId?: string;
}

/** Selectable in-app libraries + subsets (scanned, folder-loaded, and saved). */
export function useAvailableSources(): AvailSource[] {
  const manifest = useStore((s) => s.manifest);
  const extras = useStore((s) => s.extras);
  const subsets = useStore((s) => s.subsets);
  return useMemo(() => {
    const out: AvailSource[] = [];
    const seen = new Set<string>();
    for (const m of manifest) {
      out.push({ sourceId: `lib:${m.name}`, label: m.name, libName: m.name, kind: 'library', backend: m.backend });
      seen.add(m.name);
    }
    for (const name of Object.keys(extras)) {
      if (seen.has(name)) continue;
      out.push({ sourceId: `lib:${name}`, label: name, libName: name, kind: 'library', backend: 'memory' });
      seen.add(name);
    }
    for (const sub of subsets) {
      out.push({
        sourceId: `sub:${sub.id}`,
        label: `${sub.libraryId} › ${sub.name}`,
        libName: sub.libraryId,
        kind: 'subset',
        backend: 'memory',
        subsetId: sub.id,
      });
    }
    return out;
  }, [manifest, extras, subsets]);
}

/** Resolve a source to its compounds, parsing/loading the library on demand. */
export async function resolveSourceCompounds(src: AvailSource): Promise<Compound[]> {
  const st = useStore.getState();
  let lib = st.cache[src.libName] ?? st.extras[src.libName] ?? null;
  if (!lib) {
    const entry = st.manifest.find((m) => m.name === src.libName);
    if (!entry) return [];
    lib = await loadLibraryFromManifest(entry);
    st.cacheLibrary(lib);
  }
  if (src.kind === 'subset') {
    const sub = st.subsets.find((x) => x.id === src.subsetId);
    return sub ? materializeSubset(sub, lib) : [];
  }
  return lib.compounds;
}
