/**
 * Export a structure depiction for pasting into slides / vector editors.
 *
 * Produces a transparent-background SVG (vector) and a high-resolution PNG
 * raster, and writes both to the clipboard so PowerPoint/Illustrator can paste
 * whichever they support. Honors the user's current draw options.
 */
import { getRDKit } from './rdkit';
import { drawDetails, type DrawOptions } from './render';

const BASE_W = 480;
const BASE_H = 360;
// ~4× the 96dpi base ≈ 300dpi at the rendered physical size.
const RASTER_SCALE = 4;

/** Render a transparent-background SVG for the given SMILES. */
export async function structureToSvg(
  smiles: string,
  opts: DrawOptions,
  dark: boolean,
  width = BASE_W,
  height = BASE_H,
): Promise<string | null> {
  const rdkit = await getRDKit();
  const mol = rdkit.get_mol(smiles);
  try {
    if (!mol || !mol.is_valid()) return null;
    return mol.get_svg_with_highlights(
      JSON.stringify(drawDetails(width, height, opts, dark)),
    );
  } finally {
    mol?.delete();
  }
}

function svgToPng(
  svg: string,
  width: number,
  height: number,
  scale: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }
      ctx.scale(scale, scale); // transparent canvas → transparent PNG
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))),
        'image/png',
      );
    };
    img.onerror = () => reject(new Error('SVG rasterization failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/**
 * Copy the structure to the clipboard as a transparent vector (SVG) + a
 * high-res transparent PNG. Must be called from a user gesture.
 */
export async function copyStructure(
  smiles: string,
  opts: DrawOptions,
  dark: boolean,
): Promise<void> {
  const svg = await structureToSvg(smiles, opts, dark, BASE_W, BASE_H);
  if (!svg) throw new Error('Invalid structure');

  const png = await svgToPng(svg, BASE_W, BASE_H, RASTER_SCALE);
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' });

  try {
    // Prefer offering both vector + raster.
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': png, 'image/svg+xml': svgBlob }),
    ]);
  } catch {
    // Some browsers only allow image/png on the clipboard.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  }
}
