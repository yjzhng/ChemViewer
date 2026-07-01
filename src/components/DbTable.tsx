import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from '../data/store';
import { dbCount, dbPage } from '../data/dbClient';
import { StructureCell } from './StructureCell';
import { CopyCell } from './CopyCell';
import type { Compound, Library } from '../data/types';

const PAGE = 200;
const ROW_PLAIN = 30;

const BODY_FONT = '13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO_FONT = '12px ui-monospace, Menlo, Consolas, monospace';
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

interface Col {
  key: string;
  label: string;
  width: number;
  sortable: boolean;
  align?: 'right';
}

export function DbTable({ library }: { library: Library }) {
  const rules = useStore((s) => s.rules);
  const globalSearch = useStore((s) => s.globalSearch);
  const showStructures = useStore((s) => s.showStructures);
  const structureScale = useStore((s) => s.structureScale);
  const selectCompound = useStore((s) => s.selectCompound);
  const setHovered = useStore((s) => s.setHoveredCompound);

  const [sortBy, setSortBy] = useState('rid');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [total, setTotal] = useState(library.total ?? 0);
  const [error, setError] = useState<string | null>(null);

  const structW = Math.round(200 * (structureScale / 100));
  const structH = Math.round(120 * (structureScale / 100));
  const rowH = showStructures ? structH + 14 : ROW_PLAIN;

  const idKey = library.idKey ?? 'rid';
  const layout = useMemo<Col[]>(() => {
    const cols: Col[] = [];
    cols.push({ key: 'rid', label: '#', width: 72, sortable: true, align: 'right' });
    if (showStructures)
      cols.push({ key: '__struct', label: 'Structure', width: structW + 16, sortable: false });
    cols.push({ key: idKey, label: 'ID', width: 200, sortable: true });
    cols.push({ key: '__smiles', label: 'SMILES', width: 280, sortable: false });
    for (const c of library.columns) {
      // Skip the id column — it's already shown as the dedicated ID column
      // (avoids a duplicate React key and a doubled column).
      if (c.key === idKey) continue;
      cols.push({ key: c.key, label: c.label, width: 130, sortable: true });
    }
    return cols;
  }, [library.columns, idKey, showStructures, structW]);

  const query = useMemo(() => ({ rules, globalSearch }), [rules, globalSearch]);
  const queryKey = useMemo(
    () => JSON.stringify({ query, sortBy, sortDir }),
    [query, sortBy, sortDir],
  );

  const cache = useRef(new Map<number, Compound[]>());
  const loading = useRef(new Set<number>());
  const [, force] = useState(0);

  useEffect(() => {
    cache.current = new Map();
    loading.current = new Set();
    let alive = true;
    setError(null);
    dbCount(library.name, query)
      .then((r) => alive && (setTotal(r.count), force((n) => n + 1)))
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
    // queryKey captures query+sort; library.name for the active library.
  }, [library.name, queryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensurePage = (pageNo: number) => {
    if (cache.current.has(pageNo) || loading.current.has(pageNo)) return;
    loading.current.add(pageNo);
    dbPage(library.name, {
      ...query,
      orderBy: sortBy,
      dir: sortDir,
      offset: pageNo * PAGE,
      limit: PAGE,
    })
      .then((rows) => {
        cache.current.set(pageNo, rows);
        loading.current.delete(pageNo);
        force((n) => n + 1);
      })
      .catch(() => loading.current.delete(pageNo));
  };

  const rowAt = (index: number): Compound | null => {
    const page = cache.current.get(Math.floor(index / PAGE));
    if (!page) {
      ensurePage(Math.floor(index / PAGE));
      return null;
    }
    return page[index % PAGE] ?? null;
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 6,
  });

  // Re-measure when row height changes (structures toggle / compactness).
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowH]);

  const onSort = (col: Col) => {
    if (!col.sortable) return;
    if (sortBy === col.key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(col.key);
      setSortDir('asc');
    }
  };

  // Column resizing: per-column width overrides, dragged from a header handle.
  const [widths, setWidths] = useState<Record<string, number>>({});
  const effW = (c: Col) => widths[c.key] ?? c.width;

  const startResize = (e: MouseEvent, col: Col) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = effW(col);
    const onMove = (ev: globalThis.MouseEvent) =>
      setWidths((w) => ({
        ...w,
        [col.key]: Math.max(48, startW + (ev.clientX - startX)),
      }));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
  };

  // Auto-fit (double-click handle = this column, triple = all), measured over
  // the rows currently loaded in the page cache.
  const colText = (col: Col, row: Compound): string => {
    if (col.key === 'rid') return String(row.index);
    if (col.key === idKey) return row.id;
    if (col.key === '__smiles') return row.smiles;
    if (col.key === '__struct') return '';
    return String(row.props[col.key] ?? '');
  };

  const autoFitWidth = (col: Col): number => {
    if (col.key === '__struct') return effW(col);
    const font = col.key === '__smiles' ? MONO_FONT : BODY_FONT;
    let max = textWidth(col.label, BODY_FONT) + 22;
    const rows: Compound[] = [];
    for (const pageRows of cache.current.values()) {
      for (const r of pageRows) {
        rows.push(r);
        if (rows.length >= 600) break;
      }
      if (rows.length >= 600) break;
    }
    for (const r of rows) {
      const w = textWidth(colText(col, r), font);
      if (w > max) max = w;
    }
    const chipPad = col.key === idKey || col.key === '__smiles' ? 16 : 0;
    return Math.min(800, Math.max(48, Math.ceil(max) + 24 + chipPad));
  };

  const autoFit = (key: string) => {
    const col = layout.find((c) => c.key === key);
    if (col) setWidths((w) => ({ ...w, [key]: autoFitWidth(col) }));
  };
  const autoFitAll = () =>
    setWidths(() => {
      const next: Record<string, number> = {};
      for (const c of layout) if (c.key !== '__struct') next[c.key] = autoFitWidth(c);
      return next;
    });

  const clickRef = useRef<{ count: number; timer: number; key: string }>({
    count: 0,
    timer: 0,
    key: '',
  });
  const onResizerClick = (key: string) => {
    const st = clickRef.current;
    if (st.key !== key) st.count = 0;
    st.key = key;
    st.count += 1;
    window.clearTimeout(st.timer);
    st.timer = window.setTimeout(() => {
      if (st.count === 2) autoFit(key);
      else if (st.count >= 3) autoFitAll();
      st.count = 0;
    }, 280);
  };

  const cellContent = (col: Col, row: Compound) => {
    if (col.key === '__struct')
      return <StructureCell smiles={row.smiles} width={structW} height={structH} />;
    if (col.key === '__smiles') return <CopyCell mono value={row.smiles} />;
    if (col.key === 'rid') return <span className="muted">{row.index}</span>;
    if (col.key === idKey) return <CopyCell value={row.id} />;
    return <span>{String(row.props[col.key] ?? '')}</span>;
  };

  const totalWidth = layout.reduce((s, c) => s + effW(c), 0);

  return (
    <div className="table-wrap" ref={scrollRef} onMouseLeave={() => setHovered(null)}>
      {error && <div className="error-inline" style={{ padding: 8 }}>{error}</div>}
      <div className="db-grid" style={{ width: totalWidth }}>
        <div className="db-head">
          {layout.map((c) => (
            <div
              key={c.key}
              className={`db-cell${c.sortable ? ' sortable' : ''}${c.align === 'right' ? ' cell-right' : ''}`}
              style={{ width: effW(c) }}
              onClick={() => onSort(c)}
            >
              {c.label}
              {sortBy === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              {c.key !== '__struct' && (
                <span
                  className="db-resizer"
                  title="Drag to resize · double-click fit · triple-click fit all"
                  onMouseDown={(e) => startResize(e, c)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onResizerClick(c.key);
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="db-body" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rowAt(vi.index);
            return (
              <div
                key={vi.key}
                className="db-row"
                style={{ transform: `translateY(${vi.start}px)`, height: rowH }}
                onClick={() => row && selectCompound(row)}
                onMouseEnter={() => row && setHovered(row)}
              >
                {layout.map((c) => (
                  <div
                    key={c.key}
                    className={`db-cell${c.align === 'right' ? ' cell-right' : ''}`}
                    style={{ width: effW(c) }}
                  >
                    {row ? (
                      cellContent(c, row)
                    ) : c.key === '__struct' ? (
                      <div
                        className="struct-skeleton"
                        style={{ width: structW, height: structH }}
                      />
                    ) : (
                      <span className="cell-skeleton" />
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
