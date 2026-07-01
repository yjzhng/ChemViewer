import { useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { smilesToSvg } from '../chem/render';
import { copyStructure } from '../chem/exportStructure';
import { useStore } from '../data/store';

interface Props {
  smiles: string;
  width?: number;
  height?: number;
}

interface Feedback {
  ok: boolean;
  left: number;
  top: number;
}

/**
 * Renders a SMILES to a transparent SVG (theme-aware). Because the table is
 * virtualized, this only mounts for visible rows, so rendering is on demand.
 * Clicking copies a transparent, high-res vector/raster of the structure;
 * a "Copied" chip confirms it in a portal just below the structure.
 */
export function StructureCell({ smiles, width = 200, height = 120 }: Props) {
  const draw = useStore((s) => s.draw);
  const dark = useStore((s) => s.resolvedTheme === 'dark');
  const [svg, setSvg] = useState<string>('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let alive = true;
    setSvg('');
    if (!smiles) return;
    smilesToSvg(smiles, width, height, draw, dark).then((s) => {
      if (alive) setSvg(s);
    });
    return () => {
      alive = false;
    };
  }, [smiles, width, height, draw, dark]);

  const onCopy = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!smiles) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let ok = true;
    try {
      await copyStructure(smiles, draw, dark);
    } catch {
      ok = false;
    }
    setFeedback({ ok, left: rect.left, top: rect.bottom + 4 });
    window.setTimeout(() => setFeedback(null), 1100);
  };

  return (
    <>
      <div
        className="struct-cell copy-target"
        style={{ width, height }}
        title="Click to copy transparent vector (PowerPoint, Illustrator…)"
        onClick={onCopy}
      >
        <div
          className="struct-svg"
          style={{ width, height }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {feedback &&
        createPortal(
          <span
            className={`copied-pop floating${feedback.ok ? '' : ' err'}`}
            style={{ left: feedback.left, top: feedback.top }}
          >
            {feedback.ok ? 'Copied' : 'Failed'}
          </span>,
          document.body,
        )}
    </>
  );
}
