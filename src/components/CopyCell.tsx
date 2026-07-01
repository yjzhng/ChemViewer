import { useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  value: string;
  /** Render the value in a monospace font (used for SMILES). */
  mono?: boolean;
}

/**
 * A table cell value that highlights as a chip on hover and copies to the
 * clipboard when clicked. The "Copied" confirmation renders in a portal just
 * below the value so it isn't clipped by the row's overflow.
 */
export function CopyCell({ value, mono }: Props) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!value) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setPos({ left: rect.left, top: rect.bottom + 4 });
        window.setTimeout(() => setPos(null), 1000);
      })
      .catch(() => {});
  };

  return (
    <>
      <span
        className={`copy-cell${mono ? ' mono' : ''}`}
        title={value}
        onClick={onClick}
      >
        {value}
      </span>
      {pos &&
        createPortal(
          <span
            className="copied-pop floating"
            style={{ left: pos.left, top: pos.top }}
          >
            Copied
          </span>,
          document.body,
        )}
    </>
  );
}
