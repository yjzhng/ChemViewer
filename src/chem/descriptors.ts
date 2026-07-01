/**
 * Compute physchem descriptors from SMILES via RDKit.
 *
 * Fallback for libraries that arrive without precomputed property columns
 * (the bundled Enamine set already has them, so this is rarely needed in M1).
 */
import { withMol } from './rdkit';

/** Subset of RDKit's get_descriptors() output we surface as columns. */
export const DESCRIPTOR_KEYS = [
  'amw',
  'CrippenClogP',
  'NumHBD',
  'NumHBA',
  'tpsa',
  'NumRotatableBonds',
  'NumRings',
  'NumAromaticRings',
] as const;

export type DescriptorKey = (typeof DESCRIPTOR_KEYS)[number];

export async function computeDescriptors(
  smiles: string,
): Promise<Partial<Record<DescriptorKey, number>> | null> {
  return withMol(smiles, (mol) => {
    const all = JSON.parse(mol.get_descriptors()) as Record<string, number>;
    const out: Partial<Record<DescriptorKey, number>> = {};
    for (const k of DESCRIPTOR_KEYS) {
      if (typeof all[k] === 'number') out[k] = all[k];
    }
    return out;
  });
}
