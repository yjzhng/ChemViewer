import { useMemo, useState } from 'react';
import { substructureSearch } from '../chem/substructure';
import type {
  ColumnDef,
  Compound,
  FilterRule,
  NumberRangeRule,
  TextContainsRule,
  ValueInRule,
} from '../data/types';

/**
 * Controlled clone of the Browse FilterBar's chip UI (same look/classes), but
 * driven by local `rules`/`search` props instead of the global store. Used by
 * the library Author to scope a source. In-memory compounds only.
 */
const SUBSTRUCT_KEY = '__substructure__';
const fmt = (n: number) => Number(n.toFixed(2)).toLocaleString();

function upsert(
  rules: FilterRule[],
  next: FilterRule,
  match: (r: FilterRule) => boolean,
  keep: boolean,
): FilterRule[] {
  const without = rules.filter((r) => !match(r));
  return keep ? [...without, next] : without;
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

function chipSummary(column: ColumnDef, rules: FilterRule[]): string | null {
  if (column.kind === 'number') {
    const r = rules.find(
      (x) => x.type === 'number-range' && x.column === column.key,
    ) as NumberRangeRule | undefined;
    if (!r) return null;
    if (r.min !== undefined && r.max !== undefined) return `${fmt(r.min)}–${fmt(r.max)}`;
    if (r.min !== undefined) return `≥ ${fmt(r.min)}`;
    if (r.max !== undefined) return `≤ ${fmt(r.max)}`;
    return null;
  }
  const vin = rules.find(
    (x) => x.type === 'value-in' && x.column === column.key,
  ) as ValueInRule | undefined;
  if (vin && vin.values.length) {
    return vin.values.length === 1 ? vin.values[0] : `${vin.values.length} selected`;
  }
  const r = rules.find(
    (x) => x.type === 'text-contains' && x.column === column.key,
  ) as TextContainsRule | undefined;
  return r ? `"${r.query}"` : null;
}

export function QuickFilter({
  columns,
  compounds,
  rules,
  search,
  onRules,
  onSearch,
}: {
  columns: ColumnDef[];
  compounds: Compound[];
  rules: FilterRule[];
  search: string;
  onRules: (rules: FilterRule[]) => void;
  onSearch: (q: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const cols = useMemo(
    () => columns.filter((c) => c.kind === 'number' || c.kind === 'text'),
    [columns],
  );
  const openCol = cols.find((c) => c.key === open);
  const hasFilters = rules.length > 0 || search.trim() !== '';

  const setNumberRange = (column: string, min?: number, max?: number) => {
    const empty = min === undefined && max === undefined;
    onRules(
      upsert(
        rules,
        { type: 'number-range', column, min, max },
        (r) => r.type === 'number-range' && r.column === column,
        !empty,
      ),
    );
  };
  const setTextContains = (column: string, query: string) =>
    onRules(
      upsert(
        rules,
        { type: 'text-contains', column, query },
        (r) => r.type === 'text-contains' && r.column === column,
        query.trim() !== '',
      ),
    );
  const setValueIn = (column: string, values: string[]) =>
    onRules(
      upsert(
        rules,
        { type: 'value-in', column, values },
        (r) => r.type === 'value-in' && r.column === column,
        values.length > 0,
      ),
    );
  const setSubstruct = (smarts: string) =>
    onRules(
      upsert(
        rules,
        { type: 'substructure', smarts },
        (r) => r.type === 'substructure',
        smarts.trim() !== '',
      ),
    );

  const clearCol = (c: ColumnDef) => {
    if (c.kind === 'number') setNumberRange(c.key, undefined, undefined);
    else {
      setTextContains(c.key, '');
      setValueIn(c.key, []);
    }
  };

  const substructRule = rules.find((r) => r.type === 'substructure');

  return (
    <div className="filter-bar author-quickfilter">
      <div className="filter-search">
        <input
          className="search"
          placeholder="Search ID / SMILES…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="chips">
        <span className={`chip all-chip${!hasFilters ? ' active' : ''}`}>
          <button
            className="chip-main"
            onClick={() => {
              onRules([]);
              onSearch('');
              setOpen(null);
            }}
          >
            All
          </button>
        </span>
        {cols.map((c) => (
          <Chip
            key={c.key}
            label={c.label}
            summary={chipSummary(c, rules)}
            open={open === c.key}
            onToggle={() => setOpen(open === c.key ? null : c.key)}
            onClear={() => clearCol(c)}
          />
        ))}
        <Chip
          label="Substructure"
          summary={substructRule ? (substructRule as { smarts: string }).smarts : null}
          open={open === SUBSTRUCT_KEY}
          onToggle={() => setOpen(open === SUBSTRUCT_KEY ? null : SUBSTRUCT_KEY)}
          onClear={() => setSubstruct('')}
        />
      </div>

      {openCol && openCol.kind === 'number' && (
        <NumberEditor column={openCol.key} rules={rules} onChange={setNumberRange} />
      )}
      {openCol && openCol.kind === 'text' && (
        <TextEditor
          column={openCol.key}
          compounds={compounds}
          rules={rules}
          onContains={setTextContains}
          onValueIn={setValueIn}
        />
      )}
      {open === SUBSTRUCT_KEY && (
        <SubstructureEditor
          compounds={compounds}
          smarts={substructRule ? (substructRule as { smarts: string }).smarts : ''}
          onChange={setSubstruct}
        />
      )}
    </div>
  );
}

function NumberEditor({
  column,
  rules,
  onChange,
}: {
  column: string;
  rules: FilterRule[];
  onChange: (column: string, min?: number, max?: number) => void;
}) {
  const rule = rules.find((r) => r.type === 'number-range' && r.column === column) as
    | NumberRangeRule
    | undefined;
  const parse = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return (
    <div className="chip-editor">
      <label>min</label>
      <input
        type="number"
        autoFocus
        value={rule?.min ?? ''}
        onChange={(e) => onChange(column, parse(e.target.value), rule?.max)}
      />
      <label>max</label>
      <input
        type="number"
        value={rule?.max ?? ''}
        onChange={(e) => onChange(column, rule?.min, parse(e.target.value))}
      />
    </div>
  );
}

function TextEditor({
  column,
  compounds,
  rules,
  onContains,
  onValueIn,
}: {
  column: string;
  compounds: Compound[];
  rules: FilterRule[];
  onContains: (column: string, query: string) => void;
  onValueIn: (column: string, values: string[]) => void;
}) {
  const containsRule = rules.find(
    (r) => r.type === 'text-contains' && r.column === column,
  ) as TextContainsRule | undefined;
  const valueRule = rules.find((r) => r.type === 'value-in' && r.column === column) as
    | ValueInRule
    | undefined;
  const selected = useMemo(() => new Set(valueRule?.values ?? []), [valueRule]);
  const [filter, setFilter] = useState('');

  const values = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of compounds) {
      const v = String(c.props[column] ?? '');
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }, [compounds, column]);
  const capped = values.length > 500;
  const shown = (filter
    ? values.filter((v) => v.value.toLowerCase().includes(filter.toLowerCase()))
    : values
  ).slice(0, 500);

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onValueIn(column, [...next]);
  };

  return (
    <div className="chip-editor cat-editor">
      <div className="cat-row">
        <label>contains</label>
        <input
          value={containsRule?.query ?? ''}
          onChange={(e) => onContains(column, e.target.value)}
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
              <button className="cat-clear" onClick={() => onValueIn(column, [])}>
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

function SubstructureEditor({
  compounds,
  smarts,
  onChange,
}: {
  compounds: Compound[];
  smarts: string;
  onChange: (smarts: string) => void;
}) {
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);

  // Optional preview: the actual filtering runs at build time, but a quick
  // count gives the same feedback the Browse bar does.
  const run = async () => {
    const q = smarts.trim();
    if (q === '') {
      setStatus('');
      return;
    }
    setRunning(true);
    setStatus('searching…');
    const res = await substructureSearch(q, compounds.map((c) => c.smiles));
    setRunning(false);
    setStatus(res.invalidQuery ? 'invalid SMARTS' : `${res.matches.length.toLocaleString()} match`);
  };

  return (
    <div className="chip-editor">
      <label>SMARTS</label>
      <input
        autoFocus
        placeholder="c1ccccc1Br"
        value={smarts}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && run()}
      />
      <button onClick={run} disabled={running}>
        {running ? '…' : 'Preview'}
      </button>
      {status && <span className="muted">{status}</span>}
    </div>
  );
}
