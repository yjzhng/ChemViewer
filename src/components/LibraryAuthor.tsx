import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import type { ColumnDef, Compound, FilterRule, Library } from '../data/types';
import { useAvailableSources, resolveSourceCompounds } from '../data/sourcePicker';
import { applyFilters } from '../filters/engine';
import { substructureSearch } from '../chem/substructure';
import { StructureCell } from './StructureCell';
import { QuickFilter } from './QuickFilter';

type Mode = 'add' | 'remove';
type Scope =
  | { kind: 'whole' }
  | { kind: 'subset'; subsetId: string }
  | { kind: 'filter'; rules: FilterRule[]; search: string };

interface SourceCfg {
  mode: Mode;
  scope: Scope;
}

interface BuiltLibrary {
  compounds: Compound[];
  columns: ColumnDef[];
  /** Non-fatal notes surfaced under the preview (duplicates dropped, etc.). */
  notes: string[];
}

const PREVIEW_MAX = 48;

/** Parse pasted SMILES: one per line, optional id in the second column. */
function parsePasted(text: string): Compound[] {
  const out: Compound[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/[\t ]+/);
    out.push({ index: 0, id: parts[1] ?? `mol-${i + 1}`, smiles: parts[0], props: {} });
  }
  return out;
}

/** Union columns across the contributing libraries (first definition wins). */
function unionColumns(libs: Library[]): ColumnDef[] {
  const seen = new Set<string>();
  const cols: ColumnDef[] = [];
  for (const lib of libs) {
    for (const c of lib.columns) {
      if (!seen.has(c.key)) {
        seen.add(c.key);
        cols.push(c);
      }
    }
  }
  return cols;
}

/** Resolve one library source's compounds, applying its scope (subset/filter). */
async function resolveScope(libName: string, scope: Scope): Promise<Compound[]> {
  const comps = await resolveSourceCompounds({
    sourceId: `lib:${libName}`,
    label: libName,
    libName,
    kind: 'library',
    backend: 'memory',
  });
  if (scope.kind === 'subset') {
    const sub = useStore.getState().subsets.find((s) => s.id === scope.subsetId);
    if (!sub) return [];
    const members = new Set(sub.memberIds ?? []);
    return comps.filter((c) => members.has(c.id));
  }
  if (scope.kind === 'filter') {
    // Cheap rules + search first (numeric ranges, text, categorical)…
    const nonSub = scope.rules.filter((r) => r.type !== 'substructure');
    let survivors = comps;
    if (nonSub.length || scope.search.trim()) {
      const idx = applyFilters(comps, {
        rules: nonSub,
        globalSearch: scope.search,
        substructureMatches: null,
        memberIds: null,
      });
      survivors = idx.map((i) => comps[i]);
    }
    // …then any (expensive) substructure passes on the survivors.
    for (const r of scope.rules) {
      if (r.type !== 'substructure') continue;
      const q = r.smarts.trim();
      if (!q) continue;
      const res = await substructureSearch(q, survivors.map((c) => c.smiles));
      if (res.invalidQuery) throw new Error(`Invalid SMARTS filter “${q}”.`);
      survivors = res.matches.map((i) => survivors[i]);
    }
    return survivors;
  }
  return comps;
}

export function LibraryAuthor() {
  const avail = useAvailableSources();
  const cache = useStore((s) => s.cache);
  const extras = useStore((s) => s.extras);
  const subsets = useStore((s) => s.subsets);
  const registerLibrary = useStore((s) => s.registerLibrary);
  const setPage = useStore((s) => s.setPage);

  const [name, setName] = useState('New library');
  const [sources, setSources] = useState<Record<string, SourceCfg>>({});
  const [pasted, setPasted] = useState('');
  const [dedupe, setDedupe] = useState(true);
  const [built, setBuilt] = useState<BuiltLibrary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Columns loaded on demand (a scanned library must be parsed once to know its
  // numeric metrics for the Filter scope).
  const [cols, setCols] = useState<Record<string, ColumnDef[]>>({});

  // Only in-memory libraries can be merged (DuckDB libraries stay on disk).
  const libs = useMemo(
    () => avail.filter((a) => a.kind === 'library' && a.backend !== 'duckdb'),
    [avail],
  );

  // Saved subsets belonging to a library (subset.libraryId === library.id, and
  // id === name for scanned/authored libraries).
  const subsetsFor = (libName: string) => {
    const libId = (cache[libName] ?? extras[libName])?.id ?? libName;
    return subsets.filter((s) => s.libraryId === libId || s.libraryId === libName);
  };

  const libColumns = (libName: string): ColumnDef[] =>
    cols[libName] ?? (cache[libName] ?? extras[libName])?.columns ?? [];
  const libCompounds = (libName: string): Compound[] =>
    (cache[libName] ?? extras[libName])?.compounds ?? [];

  // Parse a scanned library once so its columns + values become filterable.
  const ensureCols = async (libName: string) => {
    if (cols[libName] || cache[libName] || extras[libName]) return;
    await resolveSourceCompounds({
      sourceId: `lib:${libName}`,
      label: libName,
      libName,
      kind: 'library',
      backend: 'memory',
    });
    const lib = useStore.getState().cache[libName] ?? useStore.getState().extras[libName];
    if (lib) setCols((c) => ({ ...c, [libName]: lib.columns }));
  };

  const invalidate = () => setBuilt(null);
  const setCfg = (libName: string, patch: Partial<SourceCfg> | null) => {
    invalidate();
    setSources((s) => {
      const next = { ...s };
      if (patch === null) delete next[libName];
      else next[libName] = { ...next[libName], ...patch };
      return next;
    });
  };
  const toggle = (libName: string) => {
    if (sources[libName]) setCfg(libName, null);
    else setCfg(libName, { mode: 'add', scope: { kind: 'whole' } });
  };

  // Patch the (filter) scope of a library source in place.
  const patchFilter = (
    libName: string,
    patch: Partial<{ rules: FilterRule[]; search: string }>,
  ) => {
    const cur = sources[libName]?.scope;
    if (!cur || cur.kind !== 'filter') return;
    setCfg(libName, { scope: { ...cur, ...patch } });
  };
  const chooseFilter = (libName: string) => {
    setCfg(libName, { scope: { kind: 'filter', rules: [], search: '' } });
    void ensureCols(libName);
  };

  const build = async (): Promise<BuiltLibrary | null> => {
    setError(null);
    const notes: string[] = [];
    const addPool: Compound[] = [];
    const removeKeys = new Set<string>();
    const addLibs: Library[] = [];

    for (const [libName, cfg] of Object.entries(sources)) {
      const comps = await resolveScope(libName, cfg.scope);
      if (cfg.mode === 'remove') {
        for (const c of comps) removeKeys.add(c.smiles);
      } else {
        addPool.push(...comps);
        const lib = useStore.getState().cache[libName] ?? useStore.getState().extras[libName];
        if (lib && !addLibs.includes(lib)) addLibs.push(lib);
      }
    }
    addPool.push(...parsePasted(pasted));

    if (addPool.length === 0) {
      setError('Add at least one source or some SMILES.');
      return null;
    }

    // Subtract "remove" sources, optionally de-duplicate by structure, and
    // guarantee unique ids within the new library.
    const seenSmiles = new Set<string>();
    const usedIds = new Set<string>();
    let dropped = 0;
    let removed = 0;
    const compounds: Compound[] = [];
    for (const c of addPool) {
      if (removeKeys.has(c.smiles)) {
        removed++;
        continue;
      }
      if (dedupe) {
        if (seenSmiles.has(c.smiles)) {
          dropped++;
          continue;
        }
        seenSmiles.add(c.smiles);
      }
      let id = c.id || `mol-${compounds.length + 1}`;
      if (usedIds.has(id)) {
        let n = 2;
        while (usedIds.has(`${id}-${n}`)) n++;
        id = `${id}-${n}`;
      }
      usedIds.add(id);
      compounds.push({ ...c, id, index: compounds.length });
    }

    if (removed) notes.push(`${removed.toLocaleString()} removed by subtract sources`);
    if (dropped) notes.push(`${dropped.toLocaleString()} duplicate structures dropped`);
    if (compounds.length === 0) {
      setError('The merge produced no compounds.');
      return null;
    }
    return { compounds, columns: unionColumns(addLibs), notes };
  };

  const preview = async () => {
    setBusy(true);
    try {
      setBuilt(await build());
    } catch (e) {
      setError('Build failed: ' + String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const nm = name.trim();
    if (!nm) {
      setError('Give the library a name.');
      return;
    }
    if (avail.some((a) => a.kind === 'library' && a.libName === nm)) {
      setError(`A library named “${nm}” already exists — choose another name.`);
      return;
    }
    setBusy(true);
    try {
      const result = await build();
      if (!result) return;
      const lib: Library = {
        // id === name keeps future subsets of this library resolvable.
        id: nm,
        name: nm,
        sourceFormat: 'csv',
        columns: result.columns,
        compounds: result.compounds,
        backend: 'memory',
        total: result.compounds.length,
      };
      registerLibrary(lib);
      setPage('browse');
    } catch (e) {
      setError('Create failed: ' + String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="author">
      <section className="author-config">
        <h4>New library name</h4>
        <input
          className="cmp-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Library name"
        />

        <h4>Sources to combine</h4>
        <p className="muted small author-hint">
          <strong>Add</strong> unions a library in; <strong>Remove</strong> subtracts
          it. Scope each to the whole set, a saved subset, or a substructure filter.
        </p>
        <div className="cmp-sources">
          {libs.length === 0 && <div className="muted small">No in-memory libraries available.</div>}
          {libs.map((a) => {
            const cfg = sources[a.libName];
            const mine = subsetsFor(a.libName);
            return (
              <div key={a.sourceId} className={`cmp-src${cfg ? ' on' : ''}`}>
                <div className="cmp-src-row">
                  <label className="cmp-src-check">
                    <input type="checkbox" checked={!!cfg} onChange={() => toggle(a.libName)} />
                    <span className="cmp-src-label">{a.label}</span>
                  </label>
                  {cfg && (
                    <>
                      <span className="spacer" />
                      <div className="segmented author-mode">
                        <button
                          className={cfg.mode === 'add' ? 'active' : ''}
                          onClick={() => setCfg(a.libName, { mode: 'add' })}
                        >
                          Add
                        </button>
                        <button
                          className={cfg.mode === 'remove' ? 'active' : ''}
                          onClick={() => setCfg(a.libName, { mode: 'remove' })}
                        >
                          Remove
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {cfg && (
                  <div className="author-scope">
                    <div className="segmented author-scope-seg">
                      <button
                        className={cfg.scope.kind === 'whole' ? 'active' : ''}
                        onClick={() => setCfg(a.libName, { scope: { kind: 'whole' } })}
                      >
                        Whole
                      </button>
                      <button
                        className={cfg.scope.kind === 'subset' ? 'active' : ''}
                        disabled={mine.length === 0}
                        title={mine.length === 0 ? 'No saved subsets for this library' : undefined}
                        onClick={() =>
                          setCfg(a.libName, { scope: { kind: 'subset', subsetId: mine[0].id } })
                        }
                      >
                        Subset
                      </button>
                      <button
                        className={cfg.scope.kind === 'filter' ? 'active' : ''}
                        onClick={() => chooseFilter(a.libName)}
                      >
                        Filter
                      </button>
                    </div>

                    {cfg.scope.kind === 'subset' && (
                      <select
                        value={cfg.scope.subsetId}
                        onChange={(e) =>
                          setCfg(a.libName, { scope: { kind: 'subset', subsetId: e.target.value } })
                        }
                      >
                        {mine.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({(s.memberIds?.length ?? 0).toLocaleString()})
                          </option>
                        ))}
                      </select>
                    )}

                    {cfg.scope.kind === 'filter' && (
                      <QuickFilter
                        columns={libColumns(a.libName)}
                        compounds={libCompounds(a.libName)}
                        rules={cfg.scope.rules}
                        search={cfg.scope.search}
                        onRules={(rules) => patchFilter(a.libName, { rules })}
                        onSearch={(search) => patchFilter(a.libName, { search })}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <h4>Add compounds by SMILES</h4>
        <textarea
          className="author-smiles"
          placeholder={'One per line — "SMILES [id]"\ne.g.  CCO ethanol'}
          value={pasted}
          spellCheck={false}
          onChange={(e) => {
            invalidate();
            setPasted(e.target.value);
          }}
        />

        <label className="author-opt">
          <input
            type="checkbox"
            checked={dedupe}
            onChange={(e) => {
              invalidate();
              setDedupe(e.target.checked);
            }}
          />
          Remove duplicate structures (by SMILES)
        </label>

        <div className="cmp-actions">
          <button onClick={preview} disabled={busy}>
            {busy ? 'Building…' : 'Preview'}
          </button>
          <button className="primary" onClick={create} disabled={busy}>
            Create library
          </button>
          {error && <span className="error-inline small">{error}</span>}
        </div>
      </section>

      <section className="author-preview">
        <h4>Preview</h4>
        {!built ? (
          <div className="muted small">
            Choose sources and press <strong>Preview</strong> to see the merged set.
          </div>
        ) : (
          <>
            <div className="author-summary">
              <strong>{built.compounds.length.toLocaleString()}</strong> compounds ·{' '}
              {built.columns.length} columns
              {built.notes.length > 0 && (
                <span className="muted small"> · {built.notes.join(' · ')}</span>
              )}
            </div>
            <div className="author-grid">
              {built.compounds.slice(0, PREVIEW_MAX).map((c) => (
                <div key={c.id} className="author-hit" title={c.id}>
                  <StructureCell smiles={c.smiles} width={130} height={90} />
                  <span className="author-hit-id muted">{c.id}</span>
                </div>
              ))}
            </div>
            {built.compounds.length > PREVIEW_MAX && (
              <div className="muted small">
                Showing first {PREVIEW_MAX} of {built.compounds.length.toLocaleString()}.
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
