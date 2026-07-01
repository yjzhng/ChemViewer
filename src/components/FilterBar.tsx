import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { substructureSearch } from '../chem/substructure';
import { dbDistinct } from '../data/dbClient';
import type {
  ColumnDef,
  Library,
  NumberRangeRule,
  TextContainsRule,
  ValueInRule,
} from '../data/types';

const SUBSTRUCT_KEY = '__substructure__';
const fmt = (n: number) => Number(n.toFixed(2)).toLocaleString();

/** Short summary shown on an active chip. */
function useChipSummary(column: ColumnDef): string | null {
  return useStore((s) => {
    if (column.kind === 'number') {
      const r = s.rules.find(
        (x) => x.type === 'number-range' && x.column === column.key,
      ) as NumberRangeRule | undefined;
      if (!r) return null;
      if (r.min !== undefined && r.max !== undefined)
        return `${fmt(r.min)}–${fmt(r.max)}`;
      if (r.min !== undefined) return `≥ ${fmt(r.min)}`;
      if (r.max !== undefined) return `≤ ${fmt(r.max)}`;
      return null;
    }
    const vin = s.rules.find(
      (x) => x.type === 'value-in' && x.column === column.key,
    ) as ValueInRule | undefined;
    if (vin && vin.values.length) {
      return vin.values.length === 1 ? vin.values[0] : `${vin.values.length} selected`;
    }
    const r = s.rules.find(
      (x) => x.type === 'text-contains' && x.column === column.key,
    ) as TextContainsRule | undefined;
    return r ? `"${r.query}"` : null;
  });
}

function Chip({
  label,
  summary,
  open,
  onToggle,
  onClear,
}: {
  label: string;
  summary: string | null;
  open: boolean;
  onToggle: () => void;
  onClear?: () => void;
}) {
  const active = summary !== null;
  return (
    <span className={`chip${active ? ' active' : ''}${open ? ' open' : ''}`}>
      <button className="chip-main" onClick={onToggle}>
        {label}
        {active && <span className="chip-val">{summary}</span>}
      </button>
      {active && onClear && (
        <button
          className="chip-x"
          title="Clear"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

function NumberEditor({ column }: { column: string }) {
  const rule = useStore(
    (s) =>
      s.rules.find((r) => r.type === 'number-range' && r.column === column) as
        | NumberRangeRule
        | undefined,
  );
  const setNumberRange = useStore((s) => s.setNumberRange);
  const parse = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return (
    <div className="chip-editor">
      <label>min</label>
      <input
        type="number"
        autoFocus
        value={rule?.min ?? ''}
        onChange={(e) => setNumberRange(column, parse(e.target.value), rule?.max)}
      />
      <label>max</label>
      <input
        type="number"
        value={rule?.max ?? ''}
        onChange={(e) => setNumberRange(column, rule?.min, parse(e.target.value))}
      />
    </div>
  );
}

function TextEditor({ column, library }: { column: string; library: Library }) {
  const containsRule = useStore(
    (s) =>
      s.rules.find((r) => r.type === 'text-contains' && r.column === column) as
        | TextContainsRule
        | undefined,
  );
  const valueRule = useStore(
    (s) =>
      s.rules.find((r) => r.type === 'value-in' && r.column === column) as
        | ValueInRule
        | undefined,
  );
  const setTextContains = useStore((s) => s.setTextContains);
  const setValueIn = useStore((s) => s.setValueIn);

  const selected = useMemo(
    () => new Set(valueRule?.values ?? []),
    [valueRule],
  );

  // Distinct values: query DuckDB, or compute from in-memory compounds.
  const [values, setValues] = useState<{ value: string; count: number }[]>([]);
  const [capped, setCapped] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    if (library.backend === 'duckdb') {
      dbDistinct(library.name, column)
        .then((d) => alive && (setValues(d.values), setCapped(d.capped)))
        .catch(() => {});
    } else {
      const counts = new Map<string, number>();
      for (const c of library.compounds) {
        const v = String(c.props[column] ?? '');
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const arr = [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
      setCapped(arr.length > 500);
      setValues(arr.slice(0, 500));
    }
    return () => {
      alive = false;
    };
  }, [library, column]);

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setValueIn(column, [...next]);
  };

  const shown = filter
    ? values.filter((v) => v.value.toLowerCase().includes(filter.toLowerCase()))
    : values;

  return (
    <div className="chip-editor cat-editor">
      <div className="cat-row">
        <label>contains</label>
        <input
          value={containsRule?.query ?? ''}
          onChange={(e) => setTextContains(column, e.target.value)}
        />
      </div>
      <div className="cat-row">
        <label>is</label>
        <div className="cat-picker">
          <div className="cat-picker-head">
            <input
              className="cat-filter"
              placeholder="filter values…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {selected.size > 0 && (
              <button className="cat-clear" onClick={() => setValueIn(column, [])}>
                clear ({selected.size})
              </button>
            )}
          </div>
          <div className="cat-list">
            {shown.map((v) => (
              <label key={v.value} className="cat-item">
                <input
                  type="checkbox"
                  checked={selected.has(v.value)}
                  onChange={() => toggle(v.value)}
                />
                <span className="cat-val">{v.value === '' ? '(empty)' : v.value}</span>
                <span className="muted">{v.count.toLocaleString()}</span>
              </label>
            ))}
            {shown.length === 0 && <div className="muted">No values.</div>}
            {capped && <div className="muted">…top 500 shown</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SubstructureEditor({ library }: { library: Library }) {
  const substructure = useStore((s) => s.substructure);
  const setSubstructure = useStore((s) => s.setSubstructure);
  const clearSubstructure = useStore((s) => s.clearSubstructure);
  const [smarts, setSmarts] = useState(substructure?.smarts ?? '');
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);

  const run = async () => {
    const q = smarts.trim();
    if (q === '') {
      clearSubstructure();
      setStatus('');
      return;
    }
    setRunning(true);
    setStatus('searching…');
    const result = await substructureSearch(
      q,
      library.compounds.map((c) => c.smiles),
    );
    setRunning(false);
    if (result.invalidQuery) {
      setStatus('invalid SMARTS');
      return;
    }
    setSubstructure(q, new Set(result.matches));
    setStatus(`${result.matches.length.toLocaleString()} match`);
  };

  return (
    <div className="chip-editor">
      <label>SMARTS</label>
      <input
        autoFocus
        placeholder="c1ccccc1Br"
        value={smarts}
        onChange={(e) => setSmarts(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && run()}
      />
      <button onClick={run} disabled={running}>
        {running ? '…' : 'Run'}
      </button>
      {status && <span className="muted">{status}</span>}
    </div>
  );
}

function ColumnChip({
  column,
  open,
  setOpen,
}: {
  column: ColumnDef;
  open: boolean;
  setOpen: (k: string | null) => void;
}) {
  const summary = useChipSummary(column);
  const setNumberRange = useStore((s) => s.setNumberRange);
  const setTextContains = useStore((s) => s.setTextContains);
  const setValueIn = useStore((s) => s.setValueIn);
  const clear = () => {
    if (column.kind === 'number') {
      setNumberRange(column.key, undefined, undefined);
    } else {
      setTextContains(column.key, '');
      setValueIn(column.key, []);
    }
  };
  return (
    <Chip
      label={column.label}
      summary={summary}
      open={open}
      onToggle={() => setOpen(open ? null : column.key)}
      onClear={clear}
    />
  );
}

export function FilterBar({
  library,
  dbMode = false,
}: {
  library: Library;
  /** DuckDB-backed library: hide substructure/multi-select/subset-save. */
  dbMode?: boolean;
}) {
  const globalSearch = useStore((s) => s.globalSearch);
  const setGlobalSearch = useStore((s) => s.setGlobalSearch);
  const clearFilters = useStore((s) => s.clearFilters);
  const substructure = useStore((s) => s.substructure);
  const rules = useStore((s) => s.rules);
  const saveSubset = useStore((s) => s.saveSubset);
  const multiselect = useStore((s) => s.multiselect);
  const toggleMultiselect = useStore((s) => s.toggleMultiselect);
  const selectedCount = useStore((s) => s.selected.size);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');

  const cols = useMemo(
    () =>
      library.columns.filter((c) => c.kind === 'number' || c.kind === 'text'),
    [library],
  );
  const openCol = cols.find((c) => c.key === open);

  const hasFilters =
    rules.length > 0 || substructure != null || globalSearch.trim() !== '';

  const save = async () => {
    const n = name.trim();
    if (n === '' || selectedCount === 0) return;
    await saveSubset(n);
    setName('');
  };

  const showAll = () => {
    clearFilters();
    setOpen(null);
  };

  return (
    <div className="filter-bar">
      <div className="filter-search">
        {!dbMode && (
          <button
            className={`select-toggle${multiselect ? ' active' : ''}`}
            title="Toggle multi-select"
            onClick={toggleMultiselect}
          >
            {multiselect ? `Select (${selectedCount})` : 'Select'}
          </button>
        )}
        {!dbMode && multiselect && (
          <div className="save-subset">
            <input
              className="save-name"
              placeholder="Subset name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <button onClick={save} disabled={selectedCount === 0}>
              Save
            </button>
          </div>
        )}
        <input
          className="search"
          placeholder="Search ID / SMILES…"
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
        />
      </div>

      <div className="chips">
        <span className={`chip all-chip${!hasFilters ? ' active' : ''}`}>
          <button className="chip-main" onClick={showAll}>
            All
          </button>
        </span>
        {cols.map((c) => (
          <ColumnChip key={c.key} column={c} open={open === c.key} setOpen={setOpen} />
        ))}
        {!dbMode && (
          <Chip
            label="Substructure"
            summary={substructure ? substructure.smarts : null}
            open={open === SUBSTRUCT_KEY}
            onToggle={() => setOpen(open === SUBSTRUCT_KEY ? null : SUBSTRUCT_KEY)}
          />
        )}
      </div>

      {openCol && openCol.kind === 'number' && <NumberEditor column={openCol.key} />}
      {openCol && openCol.kind === 'text' && (
        <TextEditor column={openCol.key} library={library} />
      )}
      {!dbMode && open === SUBSTRUCT_KEY && <SubstructureEditor library={library} />}
    </div>
  );
}
