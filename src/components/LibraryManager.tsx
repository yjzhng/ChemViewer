import { useRef } from 'react';
import { useStore, type LibStatus } from '../data/store';
import {
  loadLibraryFromFileList,
  loadLibraryFromFiles,
  pickDirectory,
  supportsDirectoryPicker,
} from '../data/loaders/directory';
import type { ManifestEntry } from '../data/loaders/manifest';

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
      return 'Ready';
    case 'loading':
      return 'Loading…';
    case 'precomputing':
      return `Similarity ${Math.round(s.sim * 100)}% · Shape ${Math.round(
        s.pmi * 100,
      )}%`;
    case 'error':
      return 'Precompute failed';
    default:
      return 'Queued';
  }
}

function LibraryCard({ entry }: { entry: ManifestEntry }) {
  const status = useStore((s) => s.libStatus[entry.name]);
  const active = useStore((s) => s.library?.name === entry.name);
  const selectLibraryByName = useStore((s) => s.selectLibraryByName);
  const setLibraryView = useStore((s) => s.setLibraryView);

  const ready = status?.state === 'ready';
  const pct = status
    ? Math.round(((status.sim + status.pmi) / 2) * 100)
    : 0;
  const source = entry.sourceFiles ?? [];
  const files = entry.files ?? source;
  const others = files.filter((f) => !source.includes(f));

  const open = () => {
    selectLibraryByName(entry.name);
    setLibraryView('browse');
  };

  return (
    <div className={`libcard${active ? ' active' : ''}`}>
      <div className="libcard-head">
        <div className="libcard-title">
          <FolderIcon />
          <span className="libcard-name">{entry.name}</span>
          <span className="libcard-backend muted">
            {entry.backend === 'duckdb' ? 'DuckDB' : entry.format.toUpperCase()}
          </span>
        </div>
        <div className="libcard-actions">
          <span
            className={`ready-dot${ready ? ' on' : status?.state === 'error' ? ' err' : ''}`}
          />
          <span className="muted libcard-status">{statusLabel(status)}</span>
          <button className="mini-btn" disabled={!ready} onClick={open}>
            {active ? 'Current' : 'Open'}
          </button>
        </div>
      </div>

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

      <div className="libcard-bar">
        <div
          className={`libcard-bar-fill${status?.state === 'error' ? ' err' : ''}`}
          style={{
            width: `${status?.state === 'error' ? 100 : ready ? 100 : pct}%`,
          }}
        />
      </div>
    </div>
  );
}

/** Library management: choose a scan directory and view detection + precompute. */
export function LibraryManager() {
  const manifest = useStore((s) => s.manifest);
  const directoryLabel = useStore((s) => s.directoryLabel);
  const addExtraLibrary = useStore((s) => s.addExtraLibrary);
  const setLoadError = useStore((s) => s.setLoadError);
  const libraryLoading = useStore((s) => s.libraryLoading);
  const inputRef = useRef<HTMLInputElement>(null);

  const chooseDirectory = async () => {
    setLoadError(null);
    if (supportsDirectoryPicker()) {
      try {
        const picked = await pickDirectory();
        if (picked) {
          addExtraLibrary(await loadLibraryFromFiles(picked), picked.name);
        }
      } catch (err) {
        if ((err as DOMException)?.name !== 'AbortError') {
          setLoadError(String((err as Error)?.message ?? err));
        }
      }
    } else {
      inputRef.current?.click();
    }
  };

  const onFileList = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoadError(null);
    try {
      addExtraLibrary(await loadLibraryFromFileList(files), 'picked');
    } catch (err) {
      setLoadError(String((err as Error)?.message ?? err));
    }
  };

  const readyCount = useStore(
    (s) => manifest.filter((m) => s.libStatus[m.name]?.state === 'ready').length,
  );

  return (
    <div className="manager">
      <div className="manager-head">
        <div className="manager-dir">
          <span className="muted">Scan directory</span>
          <button
            className="dir-chip"
            onClick={chooseDirectory}
            disabled={libraryLoading}
            title="Choose directory to scan"
          >
            <FolderIcon />
            <span className="dir-chip-val">{directoryLabel}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            style={{ display: 'none' }}
            // @ts-expect-error - non-standard but widely supported attribute.
            webkitdirectory=""
            directory=""
            multiple
            onChange={(e) => onFileList(e.target.files)}
          />
        </div>
        <div className="muted manager-count">
          {readyCount}/{manifest.length} ready
        </div>
      </div>

      <div className="manager-list">
        {manifest.length === 0 && (
          <div className="muted">No libraries detected in this directory.</div>
        )}
        {manifest.map((entry) => (
          <LibraryCard key={entry.name} entry={entry} />
        ))}
      </div>
    </div>
  );
}
