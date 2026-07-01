/**
 * SMILES → 2D depiction SVG, with an LRU cache.
 *
 * Depictions use a transparent background and a theme-aware palette: carbon and
 * bonds follow the foreground (black on light, white on dark) so they stay
 * visible on the app background; heteroatoms keep CPK colors in "element" mode.
 */
import { getRDKit } from './rdkit';

export type AtomPalette = 'element' | 'plain';
type RGB = [number, number, number];

/** User-configurable molecule drawing options (Settings → Chemical display). */
export interface DrawOptions {
  addStereoAnnotation?: boolean;
  addAtomIndices?: boolean;
  comicMode?: boolean;
  bondLineWidth?: number;
  /** false → draw aromatic rings delocalized instead of Kekulé. */
  kekulize?: boolean;
  atomPalette?: AtomPalette;
}

// CPK-ish colors for the heteroatoms whose hue is meaningful (0..1 floats).
const CPK: Record<number, RGB> = {
  5: [0.9, 0.6, 0.5], // B
  7: [0.13, 0.33, 0.9], // N
  8: [0.9, 0.12, 0.12], // O
  9: [0.2, 0.7, 0.2], // F
  15: [0.9, 0.5, 0.1], // P
  16: [0.75, 0.65, 0.0], // S
  17: [0.2, 0.7, 0.2], // Cl
  35: [0.6, 0.25, 0.1], // Br
  53: [0.5, 0.1, 0.6], // I
};
// On a dark background some hues are too dim — brighten them.
const CPK_DARK: Record<number, RGB> = {
  7: [0.4, 0.6, 1.0], // N — lighter blue
  35: [0.9, 0.5, 0.3], // Br — lighter brown
  53: [0.75, 0.4, 0.95], // I — lighter purple
};
const MONO_ELEMENTS = [1, 5, 6, 7, 8, 9, 14, 15, 16, 17, 33, 34, 35, 53];

/** Build the atomColourPalette for a palette mode + theme foreground. */
function buildPalette(
  palette: AtomPalette,
  dark: boolean,
): Record<string, RGB> {
  const fg: RGB = dark ? [1, 1, 1] : [0, 0, 0];
  const out: Record<string, RGB> = { '-1': fg, '1': fg, '6': fg };
  if (palette === 'plain') {
    for (const z of MONO_ELEMENTS) out[String(z)] = fg;
  } else {
    for (const [z, c] of Object.entries(CPK)) {
      out[z] = (dark && CPK_DARK[Number(z)]) || c;
    }
  }
  return out;
}

/** Build the JSON details blob for get_svg_with_highlights. */
export function drawDetails(
  width: number,
  height: number,
  opts: DrawOptions,
  dark: boolean,
): Record<string, unknown> {
  const d: Record<string, unknown> = {
    width,
    height,
    clearBackground: false, // transparent
    atomColourPalette: buildPalette(opts.atomPalette ?? 'element', dark),
  };
  if (opts.addStereoAnnotation) d.addStereoAnnotation = true;
  if (opts.addAtomIndices) d.addAtomIndices = true;
  if (opts.comicMode) d.comicMode = true;
  // Honor every level (including 1, which is thinner than RDKit's default ~2).
  if (opts.bondLineWidth) d.bondLineWidth = opts.bondLineWidth;
  if (opts.kekulize === false) d.kekulize = false;
  return d;
}

const MAX_CACHE = 2000;
const cache = new Map<string, string>();

function lruGet(key: string): string | undefined {
  const v = cache.get(key);
  if (v !== undefined) {
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}

function lruSet(key: string, value: string): void {
  cache.set(key, value);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"></svg>';

/** Render a SMILES to a transparent SVG string. Empty SVG for invalid input. */
export async function smilesToSvg(
  smiles: string,
  width = 200,
  height = 120,
  opts: DrawOptions = {},
  dark = true,
): Promise<string> {
  const key = `${smiles}@${width}x${height}@${dark ? 'd' : 'l'}@${JSON.stringify(opts)}`;
  const cached = lruGet(key);
  if (cached !== undefined) return cached;

  const rdkit = await getRDKit();
  const mol = rdkit.get_mol(smiles);
  let svg = PLACEHOLDER_SVG;
  try {
    if (mol && mol.is_valid()) {
      svg = mol.get_svg_with_highlights(
        JSON.stringify(drawDetails(width, height, opts, dark)),
      );
    }
  } finally {
    mol?.delete();
  }
  lruSet(key, svg);
  return svg;
}
