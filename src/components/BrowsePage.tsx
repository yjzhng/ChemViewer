import { useMemo } from 'react';
import { useStore, type LibraryView } from '../data/store';
import { applyFilters } from '../filters/engine';
import { FilterBar } from './FilterBar';
import { SubsetMenu } from './SubsetMenu';
import { LibraryMenu } from './LibraryMenu';
import { LibraryManager } from './LibraryManager';
import { LibraryTable } from './LibraryTable';
import { LibraryStats } from './LibraryStats';
import { DbTable } from './DbTable';
import { DbStats } from './DbStats';
import { Switch } from './Switch';

const VIEWS: { id: LibraryView; label: string }[] = [
  { id: 'manage', label: 'Manage' },
  { id: 'browse', label: 'Browse' },
];

function ViewToggle() {
  const libraryView = useStore((s) => s.libraryView);
  const setLibraryView = useStore((s) => s.setLibraryView);
  return (
    <div className="segmented view-toggle">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          className={libraryView === v.id ? 'active' : ''}
          onClick={() => setLibraryView(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

export function BrowsePage() {
  const library = useStore((s) => s.library);
  const libraryView = useStore((s) => s.libraryView);
  const rules = useStore((s) => s.rules);
  const globalSearch = useStore((s) => s.globalSearch);
  const substructure = useStore((s) => s.substructure);
  const showStructures = useStore((s) => s.showStructures);
  const toggleStructures = useStore((s) => s.toggleStructures);
  const structureScale = useStore((s) => s.structureScale);
  const selectCompound = useStore((s) => s.selectCompound);
  const libraryLoading = useStore((s) => s.libraryLoading);
  const subsets = useStore((s) => s.subsets);
  const activeSubsetId = useStore((s) => s.activeSubsetId);

  const memberIds = useMemo(() => {
    const sub = subsets.find((s) => s.id === activeSubsetId);
    return sub ? new Set(sub.memberIds ?? []) : null;
  }, [subsets, activeSubsetId]);

  const filteredCompounds = useMemo(() => {
    if (!library) return [];
    const indices = applyFilters(library.compounds, {
      rules,
      globalSearch,
      substructureMatches: substructure?.matches ?? null,
      memberIds,
    });
    return indices.map((i) => library.compounds[i]);
  }, [library, rules, globalSearch, substructure, memberIds]);

  const isDb = library?.backend === 'duckdb';
  const browsing = libraryView === 'browse';

  return (
    <div className="page">
      <header className="browse-header">
        <ViewToggle />

        {browsing && library && <LibraryMenu library={library} />}
        {browsing && library && !isDb && <SubsetMenu library={library} />}

        <span className="spacer" />

        {browsing && library && (
          <div className="toggle">
            <span>Structures</span>
            <Switch
              checked={showStructures}
              onChange={toggleStructures}
              label="Toggle structure column"
            />
          </div>
        )}
      </header>

      {libraryView === 'manage' ? (
        <LibraryManager />
      ) : !library ? (
        <div className="empty">
          {libraryLoading ? (
            <h2>Loading library…</h2>
          ) : (
            <>
              <h2>No library selected</h2>
              <p>
                Open <strong>Manage</strong> to choose a directory and see which
                libraries are ready.
              </p>
            </>
          )}
        </div>
      ) : isDb ? (
        <div className="panels">
          <section className="panel panel-mid">
            <FilterBar key={library.id} library={library} dbMode />
            <DbTable library={library} />
          </section>
          <aside className="panel panel-right">
            <DbStats library={library} />
          </aside>
        </div>
      ) : (
        <div className="panels">
          <section className="panel panel-mid">
            {/* Remount on subset switch so open chips / inputs reset too. */}
            <FilterBar key={activeSubsetId ?? 'full'} library={library} />
            <LibraryTable
              compounds={filteredCompounds}
              columns={library.columns}
              showStructures={showStructures}
              structureScale={structureScale}
              onRowClick={selectCompound}
            />
          </section>
          <aside className="panel panel-right">
            <LibraryStats library={library} filteredCompounds={filteredCompounds} />
          </aside>
        </div>
      )}
    </div>
  );
}
