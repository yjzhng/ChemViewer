import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { Ketcher } from 'ketcher-core';
import { useStore } from '../data/store';
import { useResizablePanel } from '../useResizablePanel';
import {
  blankQuery,
  type SearchMatch,
  type SearchQuery,
  type SearchResults,
} from '../data/search';
import { substructureSearch } from '../chem/substructure';
import { computeFingerprints, tanimoto } from '../chem/fingerprints';
import { useAvailableSources, resolveSourceCompounds } from '../data/sourcePicker';
import { StructureCell } from './StructureCell';

// Ketcher is huge (bundles Indigo WASM); load the canvas lazily so the rest of
// the Search UI appears instantly and Ketcher is fetched only when shown.
const SketchCanvas = lazy(() => import('./SketchCanvas'));

/** Small pencil icon for the "rename" affordance. */
function PencilIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export default function SearchPage() {
  const library = useStore((s) => s.library);
  const cache = useStore((s) => s.cache);
  const queries = useStore((s) => s.searchQueries);
  const saveQuery = useStore((s) => s.saveSearchQuery);
  const removeQuery = useStore((s) => s.removeSearchQuery);
  const avail = useAvailableSources();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ketcher, setKetcher] = useState<Ketcher | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  // Leave rename mode when switching tiles.
  useEffect(() => setRenaming(false), [selectedId]);

  const editing = queries.find((q) => q.id === selectedId) ?? null;

  // Live-selection ref so the (long-lived) Ketcher change handler always edits
  // the currently-selected query, not the one captured at init.
  const editingIdRef = useRef<string | null>(null);
  editingIdRef.current = editing?.id ?? null;
  // Suppress the 'change' echo while we programmatically load a structure.
  const programmaticRef = useRef(false);

  const searchable = useMemo(() => avail.filter((a) => a.backend !== 'duckdb'), [avail]);
  const defaultTarget = useMemo(() => {
    const activeSrc =
      library && searchable.find((a) => a.kind === 'library' && a.libName === library.name);
    return (activeSrc ?? searchable[0])?.sourceId ?? '';
  }, [library, searchable]);

  const targetId = editing ? editing.target || defaultTarget : '';
  const src = avail.find((a) => a.sourceId === targetId) ?? null;

  const patch = (p: Partial<SearchQuery>) => {
    if (!editing) return;
    saveQuery({ ...editing, ...p });
  };

  // Push a query's SMILES into the canvas whenever the selection changes.
  useEffect(() => {
    if (!ketcher || !editing) return;
    programmaticRef.current = true;
    ketcher
      .setMolecule(editing.smiles || '')
      .catch(() => {})
      .finally(() => {
        programmaticRef.current = false;
      });
    // Only re-run on selection change (not on every keystroke, which would
    // reset the canvas/cursor mid-draw).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ketcher]);

  const onKetcherInit = (k: Ketcher) => {
    setKetcher(k);
    try {
      k.editor.subscribe('change', async () => {
        try {
          const s = (await k.getSmiles()).trim();
          const id = editingIdRef.current;
          if (!id) return;
          const q = useStore.getState().searchQueries.find((x) => x.id === id);
          if (!q || q.smiles === s) return;
          useStore.getState().saveSearchQuery({ ...q, smiles: s });
        } catch {
          /* ignore transient parse states while drawing */
        }
      });
    } catch {
      /* older ketcher without editor.subscribe — canvas just won't sync out */
    }
  };

  // Load the typed SMILES into the sketch canvas (explicit, on blur / Enter).
  const loadIntoSketch = () => {
    if (!ketcher || !editing) return;
    programmaticRef.current = true;
    ketcher
      .setMolecule(editing.smiles || '')
      .catch(() => {})
      .finally(() => {
        programmaticRef.current = false;
      });
  };

  const copySmiles = async () => {
    const s = editing?.smiles.trim();
    if (!s) return;
    try {
      await navigator.clipboard.writeText(s);
      setStatus(`Copied: ${s}`);
    } catch {
      setStatus(s);
    }
  };

  const estimateSeconds = (): number => {
    if (!editing || !src) return 0;
    const n = cache[src.libName]?.compounds.length ?? 5000;
    return (editing.searchType === 'substructure' ? n * 0.06 : n * 1.2) / 1000;
  };
  const fmtEst = (s: number): string =>
    s < 1 ? '<1 s' : s < 90 ? `~${Math.round(s)} s` : `~${Math.round(s / 60)} min`;

  const run = async () => {
    if (!editing) return;
    const q = editing.smiles.trim();
    if (!q) {
      setStatus('Enter or draw a query structure first.');
      return;
    }
    if (!src || src.backend === 'duckdb') {
      setStatus('Choose an in-memory library to search (DuckDB libraries n/a).');
      return;
    }
    const base = { ...editing, target: targetId };
    setProgress(0);
    setStatus('Loading library…');
    saveQuery({ ...base, running: true });
    try {
      const pool = await resolveSourceCompounds(src);
      const smilesList = pool.map((c) => c.smiles);
      const isFullLib = src.kind === 'library';
      let results: SearchResults;

      if (base.searchType === 'substructure') {
        // Prefer a real SMARTS from the sketch; fall back to the SMILES.
        let query = q;
        if (ketcher) {
          try {
            query = (await ketcher.getSmarts()) || q;
          } catch {
            query = q;
          }
        }
        setStatus('Searching…');
        const res = await substructureSearch(query, smilesList);
        if (res.invalidQuery) {
          setStatus('Query could not be interpreted as a substructure.');
          saveQuery({ ...base, running: false });
          return;
        }
        results = {
          type: 'substructure',
          sourceLabel: src.label,
          libName: src.libName,
          isFullLib,
          query,
          count: res.matches.length,
          matches: res.matches.slice(0, base.maxResults).map((i) => ({ compound: pool[i] })),
          libIndices: isFullLib ? res.matches : undefined,
        };
      } else {
        const [qfp] = await computeFingerprints([q]);
        if (!qfp) {
          setStatus('Query SMILES is invalid — can’t fingerprint it.');
          saveQuery({ ...base, running: false });
          return;
        }
        setStatus('Fingerprinting library…');
        const fps = await computeFingerprints(smilesList, {
          onProgress: (d, t) => setProgress(t ? d / t : 0),
        });
        const scored: SearchMatch[] = [];
        for (let i = 0; i < fps.length; i++) {
          const f = fps[i];
          if (!f) continue;
          const s = tanimoto(qfp, f);
          if (s >= base.threshold) scored.push({ compound: pool[i], score: s });
        }
        scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        results = {
          type: 'similarity',
          sourceLabel: src.label,
          libName: src.libName,
          isFullLib,
          query: q,
          threshold: base.threshold,
          count: scored.length,
          matches: scored.slice(0, base.maxResults),
        };
      }
      setStatus(null);
      // Re-read in case the name/config changed while running.
      const latest = useStore.getState().searchQueries.find((x) => x.id === base.id) ?? base;
      saveQuery({ ...latest, target: targetId, results, running: false });
    } catch (e) {
      setStatus('Search failed: ' + String((e as Error)?.message ?? e));
      saveQuery({ ...base, running: false });
    }
  };

  const newQuery = () => {
    const q = blankQuery(`Query ${queries.length + 1}`);
    saveQuery(q);
    setSelectedId(q.id);
  };

  const valid = !!editing && editing.smiles.trim().length > 0;

  const { width: leftW, onMouseDown: onResize } = useResizablePanel(
    'chemviewer-search-left',
  );

  return (
    <div className="page search-page">
      <header className="browse-header">
        <span className="muted small">Substructure &amp; similarity search across your libraries.</span>
        <span className="spacer" />
        {status && <span className="muted search-status">{status}</span>}
      </header>

      <div
        className="search-build"
        style={{ gridTemplateColumns: `${leftW}px 5px minmax(0, 1fr)` }}
      >
        <aside className="cmp-list">
          <button className="cmp-new" onClick={newQuery}>
            + New query
          </button>
          {queries.length === 0 && <div className="muted cmp-empty">No queries yet.</div>}
          {queries.map((q) => (
            <div
              key={q.id}
              className={`cmp-tile${selectedId === q.id ? ' active' : ''}`}
              onClick={() => setSelectedId(q.id)}
            >
              <span
                className={`ready-dot ${q.running ? 'run' : q.results ? 'on' : ''}`}
              />
              <span className="cmp-tile-name">{q.name}</span>
              {q.results && <span className="muted cmp-tile-n">{q.results.count}</span>}
            </div>
          ))}
        </aside>

        <div
          className="panel-resizer"
          onMouseDown={onResize}
          title="Drag to resize"
        />

        <section className="search-editor">
          {!editing ? (
            <div className="muted cmp-hint">Select a query to edit, or create a new one.</div>
          ) : (
            <>
              <div className="cmp-editor-head">
                {renaming ? (
                  <input
                    className="cmp-name"
                    autoFocus
                    value={editing.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    onBlur={() => setRenaming(false)}
                    onKeyDown={(e) => e.key === 'Enter' && setRenaming(false)}
                  />
                ) : (
                  <div className="cmp-title">
                    <span className="cmp-title-text">{editing.name}</span>
                    <button
                      className="cmp-name-edit"
                      title="Rename"
                      onClick={() => setRenaming(true)}
                    >
                      <PencilIcon />
                    </button>
                  </div>
                )}
                <button
                  className="cmp-del"
                  title="Delete query"
                  onClick={() => {
                    removeQuery(editing.id);
                    setSelectedId(null);
                  }}
                  disabled={editing.running}
                >
                  Delete
                </button>
              </div>

              <div className="search-smiles-row">
                <input
                  className="search-smiles-input"
                  placeholder="Paste or type a SMILES / SMARTS query…"
                  value={editing.smiles}
                  spellCheck={false}
                  onChange={(e) => patch({ smiles: e.target.value })}
                  onBlur={loadIntoSketch}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      loadIntoSketch();
                    }
                  }}
                />
                <button onClick={loadIntoSketch} title="Load SMILES into the sketch canvas">
                  → Sketch
                </button>
                <button onClick={copySmiles} disabled={!valid}>
                  Copy
                </button>
              </div>

              <div className="ketcher-host search-canvas">
                <Suspense fallback={<div className="empty ketcher-loading">Loading sketcher…</div>}>
                  <SketchCanvas onInit={onKetcherInit} onError={(m) => setStatus(`Sketcher: ${m}`)} />
                </Suspense>
              </div>

              <div className="search-optbar">
                <label className="search-opt">
                  <span className="muted small">Search in</span>
                  <select value={targetId} onChange={(e) => patch({ target: e.target.value })}>
                    {avail.map((a) => (
                      <option key={a.sourceId} value={a.sourceId} disabled={a.backend === 'duckdb'}>
                        {a.label}
                        {a.backend === 'duckdb' ? ' (on-disk — n/a)' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="search-opt">
                  <span className="muted small">Type</span>
                  <div className="segmented">
                    <button
                      className={editing.searchType === 'substructure' ? 'active' : ''}
                      onClick={() => patch({ searchType: 'substructure' })}
                    >
                      Substructure
                    </button>
                    <button
                      className={editing.searchType === 'similarity' ? 'active' : ''}
                      onClick={() => patch({ searchType: 'similarity' })}
                    >
                      Similarity
                    </button>
                  </div>
                </label>

                {editing.searchType === 'similarity' && (
                  <label className="search-opt">
                    <span className="muted small">Min Tanimoto · {editing.threshold.toFixed(2)}</span>
                    <input
                      type="range"
                      min={0.3}
                      max={0.95}
                      step={0.05}
                      value={editing.threshold}
                      onChange={(e) => patch({ threshold: Number(e.target.value) })}
                    />
                  </label>
                )}

                <label className="search-opt">
                  <span className="muted small">Max results</span>
                  <input
                    type="number"
                    min={10}
                    step={50}
                    value={editing.maxResults}
                    onChange={(e) =>
                      patch({ maxResults: Math.max(10, Number(e.target.value) || 10) })
                    }
                  />
                </label>

                <span className="spacer" />
                <button
                  className="primary"
                  onClick={run}
                  disabled={editing.running || !valid || !src}
                >
                  {editing.running ? 'Searching…' : 'Search'}
                </button>
                {!editing.running && valid && src && (
                  <span className="cmp-estimate muted small">est. {fmtEst(estimateSeconds())}</span>
                )}
              </div>

              {editing.running && editing.searchType === 'similarity' && (
                <div className="cmp-progress">
                  <div className="cmp-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              )}

              <SearchResultsView results={editing.results} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function SearchResultsView({ results }: { results: SearchResults | null }) {
  const selectCompound = useStore((s) => s.selectCompound);
  const activeLib = useStore((s) => s.library);
  const selectLibraryByName = useStore((s) => s.selectLibraryByName);
  const setSubstructure = useStore((s) => s.setSubstructure);
  const setPage = useStore((s) => s.setPage);

  if (!results) return null;

  const summary =
    results.type === 'substructure'
      ? `${results.count.toLocaleString()} substructure ${results.count === 1 ? 'match' : 'matches'}`
      : `${results.count.toLocaleString()} ${results.count === 1 ? 'compound' : 'compounds'} at Tanimoto ≥ ${results.threshold?.toFixed(2)}`;
  const shown = results.matches.length;
  const clickable = activeLib?.name === results.libName;

  const viewInLibrary = async () => {
    if (!results.libIndices) return;
    await selectLibraryByName(results.libName);
    setSubstructure(results.query, new Set(results.libIndices));
    setPage('browse');
  };

  return (
    <div className="search-results">
      <div className="search-results-bar">
        <div>
          <strong>{summary}</strong>
          <span className="muted small"> in {results.sourceLabel}</span>
          {shown < results.count && (
            <span className="muted small"> · showing first {shown.toLocaleString()}</span>
          )}
        </div>
        <span className="spacer" />
        {results.type === 'substructure' && results.isFullLib && results.count > 0 && (
          <button onClick={viewInLibrary}>View in Library →</button>
        )}
      </div>

      {results.count === 0 ? (
        <div className="muted search-noresults">No matches. Try a looser query or threshold.</div>
      ) : (
        <div className="search-results-grid">
          {results.matches.map((m) => (
            <div
              key={m.compound.id}
              className="search-hit"
              onClick={() => clickable && selectCompound(m.compound)}
              title={clickable ? 'Open details' : undefined}
            >
              <StructureCell smiles={m.compound.smiles} width={150} height={100} />
              <div className="search-hit-meta">
                <span className="search-hit-id">{m.compound.id}</span>
                {typeof m.score === 'number' && (
                  <span className="search-hit-score">{m.score.toFixed(2)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
