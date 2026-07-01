import { useEffect, useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef as TanColumnDef,
  type ColumnSizingState,
  type Row,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ColumnDef, Compound } from '../data/types';
import { useStore } from '../data/store';
import { sampleIndices } from '../stats/sample';
import { StructureCell } from './StructureCell';
import { CopyCell } from './CopyCell';

interface Props {
  compounds: Compound[];
  columns: ColumnDef[];
  showStructures: boolean;
  /** Structure depiction scale, percentage 40–100. */
  structureScale: number;
  onRowClick: (c: Compound) => void;
}

const STRUCT_FULL_W = 200;
const STRUCT_FULL_H = 120;

const ROW_H_PLAIN = 30;
const W_SELECT = 38;
const W_INDEX = 56;
const W_ID = 130;
const W_SMILES = 240;
const W_NUMBER = 96;
const W_URL = 64;
const W_TEXT = 150;

const BODY_FONT = '13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

const isCatalogId = (label: string) => /catalog\s*id/i.test(label);

/** Per-row selection checkbox. Reads its own checked state from the store. */
function SelectCell({ id }: { id: string }) {
  const checked = useStore((s) => s.selected.has(id));
  const toggle = useStore((s) => s.toggleRowSelected);
  return (
    <input
      type="checkbox"
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      onChange={() => toggle(id)}
    />
  );
}

/** Header checkbox: selects/clears all currently filtered+sorted rows. */
function SelectAllHeader({ rows }: { rows: Row<Compound>[] }) {
  const selected = useStore((s) => s.selected);
  const setMany = useStore((s) => s.setManySelected);
  const ids = rows.map((r) => r.original.id);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      checked={allOn}
      onClick={(e) => e.stopPropagation()}
      onChange={() => setMany(ids, !allOn)}
    />
  );
}

export function LibraryTable({
  compounds,
  columns,
  showStructures,
  structureScale,
  onRowClick,
}: Props) {
  const multiselect = useStore((s) => s.multiselect);
  const selected = useStore((s) => s.selected);
  const setHovered = useStore((s) => s.setHoveredCompound);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [colSizing, setColSizing] = useState<ColumnSizingState>({});

  const scale = structureScale / 100;
  const structW = Math.round(STRUCT_FULL_W * scale);
  const structH = Math.round(STRUCT_FULL_H * scale);
  const rowH = showStructures ? structH + 14 : ROW_H_PLAIN;

  const colValue = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c]));
    return (colId: string, c: Compound): string => {
      if (colId === 'index') return String(c.index);
      if (colId === 'id') return c.id;
      if (colId === 'smiles') return c.smiles;
      const col = byKey.get(colId);
      if (!col) return '';
      const v = c.props[colId];
      if (v == null || v === '') return '';
      return col.kind === 'url' ? 'link' : String(v);
    };
  }, [columns]);

  const headerLabel = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c.label]));
    return (colId: string) =>
      colId === 'index'
        ? '#'
        : colId === 'id'
          ? 'ID'
          : colId === 'smiles'
            ? 'SMILES'
            : byKey.get(colId) ?? colId;
  }, [columns]);

  const tanColumns = useMemo<TanColumnDef<Compound>[]>(() => {
    const cols: TanColumnDef<Compound>[] = [];

    if (multiselect) {
      cols.push({
        id: 'select',
        header: (ctx) => <SelectAllHeader rows={ctx.table.getRowModel().rows} />,
        enableSorting: false,
        enableResizing: false,
        size: W_SELECT,
        cell: (ctx) => <SelectCell id={ctx.row.original.id} />,
      });
    }

    cols.push({
      id: 'index',
      header: '#',
      size: W_INDEX,
      accessorFn: (c) => c.index,
      sortingFn: 'basic',
      cell: (ctx) => (
        <span className="muted cell-right">{String(ctx.getValue())}</span>
      ),
    });

    if (showStructures) {
      cols.push({
        id: 'structure',
        header: 'Structure',
        enableSorting: false,
        enableResizing: false,
        size: structW + 12,
        cell: (ctx) => (
          <StructureCell
            smiles={ctx.row.original.smiles}
            width={structW}
            height={structH}
          />
        ),
      });
    }

    cols.push({
      id: 'id',
      header: 'ID',
      size: W_ID,
      accessorFn: (c) => c.id,
      cell: (ctx) => <CopyCell value={String(ctx.getValue() ?? '')} />,
    });

    cols.push({
      id: 'smiles',
      header: 'SMILES',
      size: W_SMILES,
      accessorFn: (c) => c.smiles,
      cell: (ctx) => <CopyCell mono value={String(ctx.getValue() ?? '')} />,
    });

    for (const col of columns) {
      // 'id' is already shown as the dedicated ID column — skip to avoid a
      // duplicate column id (React key collision) and a doubled column.
      if (col.key === 'id') continue;
      cols.push({
        id: col.key,
        header: col.label,
        size: col.kind === 'number' ? W_NUMBER : col.kind === 'url' ? W_URL : W_TEXT,
        accessorFn: (c) => c.props[col.key],
        sortingFn: col.kind === 'number' ? 'basic' : 'alphanumeric',
        cell: (ctx) => {
          const v = ctx.getValue() as number | string | undefined;
          if (v == null || v === '') return '';
          if (col.kind === 'url') {
            return (
              <a
                href={String(v)}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                link
              </a>
            );
          }
          if (isCatalogId(col.label)) return <CopyCell value={String(v)} />;
          return String(v);
        },
      });
    }
    return cols;
  }, [columns, showStructures, multiselect, structW, structH]);

  const table = useReactTable({
    data: compounds,
    columns: tanColumns,
    state: { sorting, columnSizing: colSizing },
    onSortingChange: setSorting,
    onColumnSizingChange: setColSizing,
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // ---- Auto-fit (double-click handle = this column, triple = all) ----------
  // Copy cells (id / smiles / catalog id) render the value inside a padded
  // chip, so they need extra room beyond the raw text width.
  const colByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const isCopyColumn = (colId: string) =>
    colId === 'id' ||
    colId === 'smiles' ||
    isCatalogId(colByKey.get(colId)?.label ?? '');

  const autoFitWidth = (colId: string): number => {
    // SMILES are arbitrarily long; never fit-to-content — use a fixed width.
    if (colId === 'smiles') return W_SMILES;
    const font = BODY_FONT;
    let max = textWidth(headerLabel(colId), BODY_FONT) + 22;
    for (const i of sampleIndices(compounds.length, 300)) {
      const w = textWidth(colValue(colId, compounds[i]), font);
      if (w > max) max = w;
    }
    const chipPad = isCopyColumn(colId) ? 16 : 0;
    return Math.min(800, Math.max(48, Math.ceil(max) + 24 + chipPad));
  };

  const autoFit = (colId: string) =>
    setColSizing((s) => ({ ...s, [colId]: autoFitWidth(colId) }));

  const autoFitAll = () =>
    setColSizing(() => {
      const next: ColumnSizingState = {};
      for (const c of table.getAllLeafColumns()) {
        if (c.getCanResize()) next[c.id] = autoFitWidth(c.id);
      }
      return next;
    });

  const clickRef = useRef<{ count: number; timer: number; col: string }>({
    count: 0,
    timer: 0,
    col: '',
  });
  const onResizerClick = (colId: string) => {
    const st = clickRef.current;
    if (st.col !== colId) st.count = 0;
    st.col = colId;
    st.count += 1;
    window.clearTimeout(st.timer);
    st.timer = window.setTimeout(() => {
      if (st.count === 2) autoFit(colId);
      else if (st.count >= 3) autoFitAll();
      st.count = 0;
    }, 280);
  };

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 8,
  });

  // Re-measure when row height changes (e.g. toggling structures / compactness),
  // otherwise cached offsets go stale.
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, rowH]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length
    ? totalSize - virtualRows[virtualRows.length - 1].end
    : 0;

  const colCount = tanColumns.length;
  const tableWidth = table.getTotalSize();

  return (
    <div
      className="table-wrap"
      ref={scrollRef}
      onMouseLeave={() => setHovered(null)}
    >
      <table className="grid" style={{ width: tableWidth }}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th key={header.id} style={{ width: header.getSize() }}>
                    <div className="th-inner">
                      {header.column.getCanSort() ? (
                        <button
                          className={`th-sort${
                            header.column.id === 'index' ? ' align-right' : ''
                          }`}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : ''}
                        </button>
                      ) : (
                        <span className="th-static">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                        </span>
                      )}
                      {header.column.getCanResize() && (
                        <div
                          className={`resizer${
                            header.column.getIsResizing() ? ' resizing' : ''
                          }`}
                          title="Drag to resize · double-click fit · triple-click fit all"
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onResizerClick(header.column.id);
                          }}
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr>
              <td colSpan={colCount} style={{ height: paddingTop, padding: 0 }} />
            </tr>
          )}
          {virtualRows.map((vr) => {
            const row = rows[vr.index];
            return (
              <tr
                key={row.id}
                className={selected.has(row.original.id) ? 'selected' : ''}
                onClick={() => onRowClick(row.original)}
                onMouseEnter={() => setHovered(row.original)}
                style={{ height: rowH }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr>
              <td
                colSpan={colCount}
                style={{ height: paddingBottom, padding: 0 }}
              />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
