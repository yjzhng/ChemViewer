/**
 * "Compound sources" for the Analyse page: a whole loaded library, or one of
 * its saved subsets (a stored selection of compound ids).
 */
import type { Compound, Library, Subset } from './types';

export interface CompoundSource {
  id: string;
  label: string;
  libraryId: string;
  compounds: Compound[];
}

/** Resolve a subset's member ids to the compounds in its library. */
export function materializeSubset(
  subset: Subset,
  library: Library,
): Compound[] {
  const members = new Set(subset.memberIds ?? []);
  return library.compounds.filter((c) => members.has(c.id));
}

/** Build the selectable sources from the in-memory libraries + their subsets. */
export function buildSources(
  libraries: Library[],
  subsets: Subset[],
): CompoundSource[] {
  const out: CompoundSource[] = [];
  for (const lib of libraries) {
    out.push({
      id: `lib:${lib.id}`,
      label: `${lib.name} (full · ${lib.compounds.length.toLocaleString()})`,
      libraryId: lib.id,
      compounds: lib.compounds,
    });
    for (const sub of subsets.filter((s) => s.libraryId === lib.id)) {
      const compounds = materializeSubset(sub, lib);
      out.push({
        id: `sub:${sub.id}`,
        label: `${lib.name} › ${sub.name} (${compounds.length.toLocaleString()})`,
        libraryId: lib.id,
        compounds,
      });
    }
  }
  return out;
}
