import { useRef, useState } from 'react';
import { useStore, type LibStatus } from '../data/store';
import { loadLibraryFromFileList } from '../data/loaders/directory';
import type { ManifestEntry } from '../data/loaders/manifest';
import type { Library } from '../data/types';

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function DragIcon() {
  return (
    <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="3" r="1.3" />
      <circle cx="8.5" cy="3" r="1.3" />
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8.5" cy="8" r="1.3" />
      <circle cx="3.5" cy="13" r="1.3" />
      <circle cx="8.5" cy="13" r="1.3" />
    </svg>
  );
}

function TileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

// View + custom order are UI prefs, persisted in localStorage.
type LibView = 'tile' | 'list';
const VIEW_KEY = 'chemviewer-lib-view';
const ORDER_KEY = 'chemviewer-lib-order';

function loadView(): LibView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'tile';
  } catch {
    return 'tile';
  }
}
function saveView(v: LibView) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* ignore */
  }
}
function loadOrder(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveOrder(o: string[]) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

const COLS_KEY = 'chemviewer-lib-cols';
const COL_CHOICES = [2, 3, 4, 5];
const DEFAULT_COLS = 3;

function loadCols(): number {
  try {
    const n = Number(localStorage.getItem(COLS_KEY));
    return COL_CHOICES.includes(n) ? n : DEFAULT_COLS;
  } catch {
    return DEFAULT_COLS;
  }
}
function saveCols(n: number) {
  try {
    localStorage.setItem(COLS_KEY, String(n));
  } catch {
    /* ignore */
  }
}
// Order existing names by the saved order; unknown/new names keep their natural order at the end.
function applyOrder(names: string[], saved: string[]): string[] {
  const known = saved.filter((n) => names.includes(n));
  const rest = names.filter((n) => !known.includes(n));
  return [...known, ...rest];
}

function formatBytes(n?: number): string | null {
  if (n == null) return null;
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function statusLabel(s: LibStatus | undefined): string {
  if (!s) return 'Queued';
  switch (s.state) {
    case 'ready':
      // Ready (map done, browsable); the 3D-shape pass may still be running.
      return s.pmi >= 1 ? 'Ready' : `Ready · shape ${Math.round(s.pmi * 100)}%`;
    case 'loading':
      return 'Loading…';
    case 'precomputing':
      return `Map ${Math.round(s.sim * 100)}%`;
    case 'error':
      return 'Precompute failed';
    default:
      return 'Queued';
  }
}

function LibraryCard({
  entry,
  manageMode,
  view,
}: {
  entry: ManifestEntry;
  manageMode: boolean;
  view: LibView;
}) {
  const status = useStore((s) => s.libStatus[entry.name]);
  const cached = useStore((s) => s.cache[entry.name]);
  const active = useStore((s) => s.library?.name === entry.name);
  const selectLibraryByName = useStore((s) => s.selectLibraryByName);
  const setPage = useStore((s) => s.setPage);
  const initFromManifest = useStore((s) => s.initFromManifest);
  const [removing, setRemoving] = useState(false);

  // Deleting a scanned library removes its folder from disk — desktop-only.
  const canRemove =
    typeof window !== 'undefined' && !!window.chemviewer?.deleteLibrary;

  const remove = async () => {
    if (
      !window.confirm(
        `Delete “${entry.name}”? This permanently removes the library files from disk.`,
      )
    )
      return;
    setRemoving(true);
    try {
      const res = await window.chemviewer!.deleteLibrary!(entry.name);
      if (res.error) {
        window.alert(res.error);
        return;
      }
      await initFromManifest();
    } finally {
      setRemoving(false);
    }
  };

  const ready = status?.state === 'ready';
  const pct = status
    ? Math.round(((status.sim + status.pmi) / 2) * 100)
    : 0;
  const source = entry.sourceFiles ?? [];
  const files = entry.files ?? source;
  const others = files.filter((f) => !source.includes(f));
  // "Library size" = compound count: from the scan (memory libs) or, once opened,
  // the loaded/DuckDB total.
  const count = entry.count ?? cached?.total ?? cached?.compounds.length;
  const fileSize = formatBytes(entry.size);

  const open = () => {
    selectLibraryByName(entry.name);
    setPage('browse');
  };

  return (
    <div className={`libcard${active ? ' active' : ''}`}>
      <div className="libcard-head">
        <div className="libcard-title">
          {manageMode && (
            <span className="drag-handle" title="Drag to reorder">
              <DragIcon />
            </span>
          )}
          <FolderIcon />
          <span className="libcard-name">{entry.name}</span>
          {view === 'list' && (
            <span className="libcard-backend muted">
              {entry.backend === 'duckdb' ? 'DuckDB' : entry.format.toUpperCase()}
            </span>
          )}
        </div>
        <div className="libcard-actions">
          {view === 'list' && (
            <>
              <span
                className={`ready-dot${ready ? ' on' : status?.state === 'error' ? ' err' : ''}`}
              />
              <span className="muted libcard-status">{statusLabel(status)}</span>
            </>
          )}
          {manageMode && canRemove && (
            <button
              className="mini-btn danger"
              disabled={removing}
              onClick={remove}
              title="Delete this library from disk"
            >
              {removing ? 'Removing…' : 'Delete'}
            </button>
          )}
          <button className="mini-btn" disabled={!ready} onClick={open}>
            {status?.state === 'error'
              ? 'Failed'
              : ready
                ? active
                  ? 'Current'
                  : 'Open'
                : 'Processing…'}
          </button>
        </div>
      </div>

      {view === 'tile' ? (
        <div className="libcard-stats">
          {count != null && <span>{count.toLocaleString()} compounds</span>}
          {count != null && fileSize && <span className="stat-sep">·</span>}
          {fileSize && <span className="muted">{fileSize}</span>}
          <span className="libcard-chip">
            {entry.backend === 'duckdb' ? 'DuckDB' : entry.format.toUpperCase()}
          </span>
        </div>
      ) : (
        <div className="libcard-files">
          <div className="fileline">
            <span className="filekey muted">Source</span>
            <span className="fileval">{source.join(', ') || '—'}</span>
          </div>
          {others.length > 0 && (
            <div className="fileline">
              <span className="filekey muted">Other files</span>
              <span className="fileval muted">{others.join(', ')}</span>
            </div>
          )}
        </div>
      )}

      <div className="libcard-bar">
        <div
          className={`libcard-bar-fill${status?.state === 'error' ? ' err' : ''}`}
          style={{ width: `${status?.state === 'error' ? 100 : pct}%` }}
        />
      </div>
    </div>
  );
}

/** Card for an in-memory (authored or folder-loaded) library — always ready. */
function ExtraLibraryCard({
  library,
  manageMode,
  view,
}: {
  library: Library;
  manageMode: boolean;
  view: LibView;
}) {
  const active = useStore((s) => s.library?.name === library.name);
  const selectLibraryByName = useStore((s) => s.selectLibraryByName);
  const removeLibrary = useStore((s) => s.removeLibrary);
  const setPage = useStore((s) => s.setPage);

  const open = () => {
    selectLibraryByName(library.name);
    setPage('browse');
  };

  return (
    <div className={`libcard${active ? ' active' : ''}`}>
      <div className="libcard-head">
        <div className="libcard-title">
          {manageMode && (
            <span className="drag-handle" title="Drag to reorder">
              <DragIcon />
            </span>
          )}
          <FolderIcon />
          <span className="libcard-name">{library.name}</span>
          {view === 'list' && (
            <span className="libcard-backend muted">in-memory</span>
          )}
        </div>
        <div className="libcard-actions">
          {view === 'list' && (
            <>
              <span className="ready-dot on" />
              <span className="muted libcard-status">Ready</span>
            </>
          )}
          {manageMode && (
            <button
              className="mini-btn danger"
              title="Discard this in-memory library"
              onClick={() => removeLibrary(library.name)}
            >
              Remove
            </button>
          )}
          <button className="mini-btn" onClick={open}>
            {active ? 'Current' : 'Open'}
          </button>
        </div>
      </div>

      {view === 'tile' ? (
        <div className="libcard-stats">
          <span>{library.compounds.length.toLocaleString()} compounds</span>
          <span className="stat-sep">·</span>
          <span className="muted">{library.columns.length} columns</span>
          <span className="libcard-chip">in-memory</span>
        </div>
      ) : (
        <div className="libcard-files">
          <div className="fileline">
            <span className="filekey muted">Compounds</span>
            <span className="fileval">
              {library.compounds.length.toLocaleString()} ·{' '}
              {library.columns.length} columns
            </span>
          </div>
        </div>
      )}

      <div className="libcard-bar">
        <div className="libcard-bar-fill" style={{ width: '100%' }} />
      </div>
    </div>
  );
}

/** Import dialog: name the library, pick files, choose copy vs move. */
function ImportDialog({ onClose }: { onClose: () => void }) {
  const addExtraLibrary = useStore((s) => s.addExtraLibrary);
  const initFromManifest = useStore((s) => s.initFromManifest);
  const isDesktop =
    typeof window !== 'undefined' && !!window.chemviewer?.importLibraryFiles;

  const [name, setName] = useState('');
  const [mode, setMode] = useState<'copy' | 'move'>('copy');
  const [picked, setPicked] = useState<{ paths: string[]; names: string[] }>({
    paths: [],
    names: [],
  });
  const [browserFiles, setBrowserFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedNames = isDesktop
    ? picked.names
    : browserFiles
      ? Array.from(browserFiles).map((f) => f.name)
      : [];
  const canImport = name.trim().length > 0 && selectedNames.length > 0 && !busy;
  const nameFromFile = (f: string) => f.replace(/\.[^.]+$/, '');

  const chooseDesktop = async () => {
    setError(null);
    const res = await window.chemviewer!.pickLibraryFiles!();
    if (res.canceled || !res.paths?.length) return;
    setPicked({ paths: res.paths, names: res.names ?? [] });
    if (!name.trim() && res.names?.[0]) setName(nameFromFile(res.names[0]));
  };

  const chooseBrowser = (files: FileList | null) => {
    if (!files?.length) return;
    setBrowserFiles(files);
    if (!name.trim()) setName(nameFromFile(files[0].name));
  };

  const doImport = async () => {
    setError(null);
    setBusy(true);
    try {
      if (isDesktop) {
        const res = await window.chemviewer!.importLibraryFiles!({
          name: name.trim(),
          mode,
          paths: picked.paths,
        });
        if (res.error) {
          setError(res.error);
          return;
        }
        await initFromManifest(); // re-scan so the new library appears
      } else {
        if (!browserFiles) return;
        const lib = await loadLibraryFromFileList(browserFiles);
        addExtraLibrary({ ...lib, name: name.trim() }, name.trim());
      }
      onClose();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="import-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-detail-head">
          <h2>Import library</h2>
        </div>

        <div className="import-field">
          <div className="import-field-label">Library name</div>
          <input
            className="import-name-input"
            value={name}
            placeholder="e.g. My compounds"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="import-field">
          <div className="import-field-label">Files</div>
          <button
            className="import-choose"
            onClick={
              isDesktop ? chooseDesktop : () => inputRef.current?.click()
            }
          >
            Choose files…
          </button>
          {!isDesktop && (
            <input
              ref={inputRef}
              type="file"
              style={{ display: 'none' }}
              accept=".csv,.sdf,.sd,.smiles,.smi,.cxsmiles"
              multiple
              onChange={(e) => chooseBrowser(e.target.files)}
            />
          )}
          {selectedNames.length > 0 ? (
            <ul className="import-files">
              {selectedNames.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : (
            <div className="muted">
              No files selected. Accepts .csv, .sdf, .smiles, .cxsmiles.
            </div>
          )}
        </div>

        {isDesktop ? (
          <div className="import-field">
            <div className="import-field-label">Storage</div>
            <div className="segmented">
              <button
                className={mode === 'copy' ? 'active' : ''}
                onClick={() => setMode('copy')}
              >
                Copy
              </button>
              <button
                className={mode === 'move' ? 'active' : ''}
                onClick={() => setMode('move')}
              >
                Move
              </button>
            </div>
            <div className={`muted import-mode-hint${mode === 'move' ? ' warn' : ''}`}>
              {mode === 'move'
                ? 'The file will be removed from its current location and stored under the app’s library folder.'
                : 'A copy is stored under the app’s library folder; the original stays put.'}
            </div>
          </div>
        ) : (
          <div className="muted import-mode-hint">
            Files load into this session only. Use the desktop app to store
            libraries permanently.
          </div>
        )}

        {error && <div className="manager-error">{error}</div>}

        <div className="import-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="import-btn" disabled={!canImport} onClick={doImport}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

type LibItem =
  | { name: string; kind: 'scanned'; entry: ManifestEntry }
  | { name: string; kind: 'extra'; library: Library };

/** Library management: import/create libraries, reorder/delete, and view status. */
export function LibraryManager({ onCreate }: { onCreate: () => void }) {
  const manifest = useStore((s) => s.manifest);
  const extras = useStore((s) => s.extras);
  const loadError = useStore((s) => s.loadError);
  const libraryLoading = useStore((s) => s.libraryLoading);
  const [importOpen, setImportOpen] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [view, setView] = useState<LibView>(loadView());
  const [cols, setCols] = useState<number>(loadCols());
  const [order, setOrder] = useState<string[]>(loadOrder());
  // Drag-reorder is tracked by library name (stable while the DOM shifts).
  const [dragName, setDragName] = useState<string | null>(null);
  const [overName, setOverName] = useState<string | null>(null);

  // In-memory libraries (authored via Create, or browser-loaded) that aren't
  // part of the on-disk scan.
  const extraLibs = Object.values(extras).filter(
    (l) => !manifest.some((m) => m.name === l.name),
  );

  const readyCount = useStore(
    (s) => manifest.filter((m) => s.libStatus[m.name]?.state === 'ready').length,
  );

  // Unified, user-ordered list of all libraries (scanned + in-memory).
  const all: LibItem[] = [
    ...manifest.map((e) => ({ name: e.name, kind: 'scanned' as const, entry: e })),
    ...extraLibs.map((l) => ({ name: l.name, kind: 'extra' as const, library: l })),
  ];
  const items = applyOrder(
    all.map((x) => x.name),
    order,
  )
    .map((n) => all.find((x) => x.name === n))
    .filter((x): x is LibItem => !!x);

  const chooseView = (v: LibView) => {
    setView(v);
    saveView(v);
  };

  const chooseCols = (n: number) => {
    setCols(n);
    saveCols(n);
  };

  // Live preview: while dragging, show items in the order they'd end up, with the
  // dragged item's slot rendered as a placeholder (works in both grid and list).
  const preview = (): LibItem[] => {
    if (!dragName || !overName || dragName === overName) return items;
    const arr = [...items];
    const from = arr.findIndex((x) => x.name === dragName);
    const to = arr.findIndex((x) => x.name === overName);
    if (from < 0 || to < 0) return items;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    return arr;
  };

  const endDrag = () => {
    setDragName(null);
    setOverName(null);
  };

  const commitDrop = () => {
    const names = preview().map((x) => x.name);
    setOrder(names);
    saveOrder(names);
    endDrag();
  };

  return (
    <div className="manager">
      <div className="manager-head">
        <button
          className="import-btn"
          onClick={() => setImportOpen(true)}
          disabled={libraryLoading}
          title="Import a library into the app"
        >
          <PlusIcon />
          Import library
        </button>
        <button className="create-btn" onClick={onCreate} title="Create a new library">
          <PlusIcon />
          Create library
        </button>

        <span className="spacer" />

        <button
          className={`mini-btn${manageMode ? ' active' : ''}`}
          onClick={() => setManageMode((v) => !v)}
          title="Reorder or delete libraries"
        >
          {manageMode ? 'Done' : 'Manage'}
        </button>
        <div className="segmented view-toggle">
          <button
            className={view === 'tile' ? 'active' : ''}
            onClick={() => chooseView('tile')}
            title="Tile view"
            aria-label="Tile view"
          >
            <TileIcon />
          </button>
          <button
            className={view === 'list' ? 'active' : ''}
            onClick={() => chooseView('list')}
            title="List view"
            aria-label="List view"
          >
            <ListIcon />
          </button>
        </div>
        {view === 'tile' && (
          <div className="segmented cols-toggle" title="Columns">
            {COL_CHOICES.map((n) => (
              <button
                key={n}
                className={cols === n ? 'active' : ''}
                onClick={() => chooseCols(n)}
                aria-label={`${n} columns`}
              >
                {n}
              </button>
            ))}
          </div>
        )}
        <div className="muted manager-count">
          {readyCount}/{manifest.length} ready
        </div>
      </div>

      {loadError && <div className="manager-error">{loadError}</div>}

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}

      {items.length === 0 ? (
        <div className="muted">
          No libraries yet. Use <strong>Import library</strong> to add one.
        </div>
      ) : (
        <div
          className={`manager-list ${view}`}
          style={
            view === 'tile'
              ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
              : undefined
          }
        >
          {preview().map((it) => (
            <div
              key={it.name}
              className={`lib-item${manageMode ? ' manage' : ''}${it.name === dragName ? ' dragging' : ''}`}
              draggable={manageMode}
              onDragStart={() => manageMode && setDragName(it.name)}
              onDragOver={(e) => {
                if (!manageMode) return;
                e.preventDefault();
                if (it.name !== dragName) setOverName(it.name);
              }}
              onDrop={(e) => {
                if (!manageMode) return;
                e.preventDefault();
                commitDrop();
              }}
              onDragEnd={endDrag}
            >
              {it.name === dragName ? (
                <div className="lib-placeholder" />
              ) : it.kind === 'scanned' ? (
                <LibraryCard
                  entry={it.entry}
                  manageMode={manageMode}
                  view={view}
                />
              ) : (
                <ExtraLibraryCard
                  library={it.library}
                  manageMode={manageMode}
                  view={view}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
