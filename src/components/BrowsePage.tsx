import { useEffect, useMemo } from 'react';
import { useStore } from '../data/store';
import { applyFilters } from '../filters/engine';
import { FilterBar } from './FilterBar';
import { SubsetMenu } from './SubsetMenu';
import { LibraryMenu } from './LibraryMenu';
import { LibraryTable } from './LibraryTable';
import { LibraryStats } from './LibraryStats';
import { DbTable } from './DbTable';
import { DbStats } from './DbStats';
import { Switch } from './Switch';

export function BrowsePage() {
  const library = useStore((s) => s.library);
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
  const manifest = useStore((s) => s.manifest);
  const libStatus = useStore((s) => s.libStatus);
  const selectLibraryByName = useStore((s) => s.selectLibraryByName);

  // With nothing open yet, auto-open the first ready library so the user lands
  // on data instead of an empty prompt.
  useEffect(() => {
    if (library || libraryLoading) return;
    const ready = manifest.find((m) => libStatus[m.name]?.state === 'ready');
    if (ready) selectLibraryByName(ready.name);
  }, [library, libraryLoading, manifest, libStatus, selectLibraryByName]);

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

  return (
    <div className="page">
      <header className="browse-header">
        {library && <LibraryMenu library={library} />}
        {library && !isDb && <SubsetMenu library={library} />}

        <span className="spacer" />

        {library && (
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

      {!library ? (
        libraryLoading || manifest.length > 0 ? (
          // Keep the Browse shell (panels) and show the loading state only in
          // the table area — parsing the rows is the slow part, not the chrome.
          <div className="panels">
            <section className="panel panel-mid">
              <div className="table-loading">
                {libraryLoading ? (
                  <span className="muted">Loading library…</span>
                ) : (
                  <>
                    <span className="muted">Preparing libraries…</span>
                    <span className="muted small">
                      Still precomputing — this opens automatically once one is
                      ready (see <strong>Manage</strong> for progress).
                    </span>
                  </>
                )}
              </div>
            </section>
            <aside className="panel panel-right" />
          </div>
        ) : (
          <div className="empty">
            <h2>No libraries found</h2>
            <p>
              Open <strong>Manage</strong> to choose a directory to scan.
            </p>
          </div>
        )
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
