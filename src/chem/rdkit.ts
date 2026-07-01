/**
 * Singleton loader for the RDKit WASM module.
 *
 * The glue script is loaded via a <script> tag in index.html, which puts
 * `initRDKitModule` on window. We call it once and share the resulting module
 * everywhere. All callers should `await getRDKit()`.
 */

/** Minimal shape of an RDKit molecule object (only what ChemViewer uses). */
export interface RDKitMol {
  is_valid(): boolean;
  get_svg(width?: number, height?: number): string;
  /** SVG with a JSON details blob (highlights + MolDraw options). */
  get_svg_with_highlights(details: string): string;
  get_smiles(): string;
  get_substruct_match(query: RDKitMol): string;
  get_descriptors(): string;
  /** Morgan fingerprint as a '0'/'1' bit string. Options: {radius,nBits}. */
  get_morgan_fp(options: string): string;
  delete(): void;
}

export interface RDKitModule {
  /** Returns null when the input can't be constructed into a molecule. */
  get_mol(smiles: string): RDKitMol | null;
  get_qmol(smarts: string): RDKitMol | null;
  version(): string;
}

declare global {
  interface Window {
    initRDKitModule?: (opts?: {
      locateFile?: (file: string) => string;
    }) => Promise<RDKitModule>;
  }
}

let rdkitPromise: Promise<RDKitModule> | null = null;

export function getRDKit(): Promise<RDKitModule> {
  if (rdkitPromise) return rdkitPromise;

  rdkitPromise = new Promise<RDKitModule>((resolve, reject) => {
    if (!window.initRDKitModule) {
      reject(
        new Error(
          'initRDKitModule not found — the RDKit script in index.html failed to load.',
        ),
      );
      return;
    }
    window
      .initRDKitModule({ locateFile: (f) => `/rdkit/${f}` })
      .then(resolve)
      .catch(reject);
  });

  return rdkitPromise;
}

/**
 * Run a function with a freshly parsed molecule and guarantee it is freed.
 * RDKit mols are WASM heap objects that must be `.delete()`d to avoid leaks.
 */
export async function withMol<T>(
  smiles: string,
  fn: (mol: RDKitMol) => T,
): Promise<T | null> {
  const rdkit = await getRDKit();
  const mol = rdkit.get_mol(smiles);
  try {
    if (!mol || !mol.is_valid()) return null;
    return fn(mol);
  } finally {
    mol?.delete();
  }
}
