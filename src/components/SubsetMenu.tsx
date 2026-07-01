import { useEffect, useRef, useState } from 'react';
import { useStore } from '../data/store';
import type { Library, Subset } from '../data/types';

/** Subset selector: a dropdown button with a default "Full" + saved subsets. */
export function SubsetMenu({ library }: { library: Library }) {
  const subsets = useStore((s) => s.subsets);
  const activeSubsetId = useStore((s) => s.activeSubsetId);
  const activeName = useStore((s) => s.activeSubsetName());
  const applySubset = useStore((s) => s.applySubset);
  const selectFull = useStore((s) => s.selectFull);
  const deleteSubset = useStore((s) => s.deleteSubset);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const mine = subsets.filter((s) => s.libraryId === library.id);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const apply = (subset: Subset) => {
    applySubset(subset);
    setOpen(false);
  };

  return (
    <div className="subset-menu" ref={ref}>
      <button className="dropdown-btn" onClick={() => setOpen((o) => !o)}>
        Subset: <strong>{activeName}</strong>
        <span className="caret">▾</span>
      </button>

      {open && (
        <div className="subset-pop">
          <button
            className={`pop-item${activeSubsetId === null ? ' active' : ''}`}
            onClick={() => {
              selectFull();
              setOpen(false);
            }}
          >
            Full
            <span className="muted">{library.compounds.length.toLocaleString()}</span>
          </button>

          {mine.map((s) => (
            <div
              key={s.id}
              className={`pop-item row${activeSubsetId === s.id ? ' active' : ''}`}
            >
              <button className="pop-apply" onClick={() => apply(s)}>
                {s.name}
                <span className="muted">
                  {(s.memberIds?.length ?? 0).toLocaleString()}
                </span>
              </button>
              <button
                className="pop-del"
                title="Delete subset"
                onClick={() => deleteSubset(s.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
