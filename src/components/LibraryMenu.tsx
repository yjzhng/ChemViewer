import { useEffect, useRef, useState } from 'react';
import { useStore } from '../data/store';
import type { Library } from '../data/types';

/** Library selector — same dropdown styling as the subset menu. */
export function LibraryMenu({ library }: { library: Library }) {
  const manifest = useStore((s) => s.manifest);
  const extras = useStore((s) => s.extras);
  const libStatus = useStore((s) => s.libStatus);
  const setPage = useStore((s) => s.setPage);
  const selectLibraryByName = useStore((s) => s.selectLibraryByName);
  const libraryLoading = useStore((s) => s.libraryLoading);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Only offer libraries whose precompute is ready — so switching always lands
  // on instantly-rendered data. Folder-loaded extras and the active library are
  // always listed (never a dead-end dropdown).
  const names: string[] = [];
  for (const m of manifest) {
    if (libStatus[m.name]?.state === 'ready') names.push(m.name);
  }
  for (const k of Object.keys(extras)) if (!names.includes(k)) names.push(k);
  if (!names.includes(library.name)) names.unshift(library.name);
  const notReadyCount = manifest.filter(
    (m) => libStatus[m.name]?.state !== 'ready',
  ).length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (name: string) => {
    if (name !== library.name) selectLibraryByName(name);
    setOpen(false);
  };

  return (
    <div className="subset-menu" ref={ref}>
      <button
        className="dropdown-btn"
        disabled={libraryLoading}
        onClick={() => setOpen((o) => !o)}
      >
        Library: <strong>{library.name}</strong>
        <span className="caret">▾</span>
      </button>

      {open && (
        <div className="subset-pop">
          {names.map((n) => (
            <button
              key={n}
              className={`pop-item${n === library.name ? ' active' : ''}`}
              onClick={() => pick(n)}
            >
              {n}
            </button>
          ))}
          {notReadyCount > 0 && (
            <button
              className="pop-item muted"
              onClick={() => {
                setPage('manage');
                setOpen(false);
              }}
            >
              {notReadyCount} preparing — Manage…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
