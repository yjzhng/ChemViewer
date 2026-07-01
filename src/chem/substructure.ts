/**
 * Substructure (SMARTS) search over a list of SMILES.
 *
 * The query is parsed once; each target SMILES is parsed, tested, and freed.
 * This runs synchronously over the whole library, so callers should gate it
 * behind an explicit action (not live-on-keystroke).
 */
import { getRDKit } from './rdkit';

export interface SubstructureResult {
  /** Indices into the input array that match the query. */
  matches: number[];
  /** True if the SMARTS query itself failed to parse. */
  invalidQuery: boolean;
}

export async function substructureSearch(
  smarts: string,
  smilesList: string[],
): Promise<SubstructureResult> {
  const rdkit = await getRDKit();
  const query = rdkit.get_qmol(smarts);
  try {
    if (!query || !query.is_valid()) return { matches: [], invalidQuery: true };

    const matches: number[] = [];
    for (let i = 0; i < smilesList.length; i++) {
      const mol = rdkit.get_mol(smilesList[i]);
      try {
        if (!mol || !mol.is_valid()) continue;
        const hit = mol.get_substruct_match(query);
        // get_substruct_match returns "{}" (no atoms) when there is no match.
        if (hit && hit !== '{}') matches.push(i);
      } finally {
        mol?.delete();
      }
    }
    return { matches, invalidQuery: false };
  } finally {
    query?.delete();
  }
}
