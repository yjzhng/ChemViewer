/** Helpers shared across the CSV / SMILES / SDF loaders. */
import type { ColumnDef, ColumnKind, Compound } from '../types';

const SMILES_HEADERS = new Set(['smiles', 'structure', 'canonical_smiles']);
const ID_HEADERS = [
  'catalog id',
  'catalog number',
  'id',
  'idnumber',
  'compound id',
  'name',
];

export function isSmilesHeader(h: string): boolean {
  return SMILES_HEADERS.has(h.trim().toLowerCase());
}

/** Pick the column index that should act as the compound id, or -1. */
export function findIdColumn(headers: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const cand of ID_HEADERS) {
    const i = lower.indexOf(cand);
    if (i >= 0) return i;
  }
  return -1;
}

function looksNumeric(value: string): boolean {
  if (value.trim() === '') return false;
  return !Number.isNaN(Number(value));
}

function looksUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** Infer a column's kind from a sample of its values. */
export function inferKind(label: string, sample: string[]): ColumnKind {
  const nonEmpty = sample.filter((v) => v != null && v.trim() !== '');
  if (nonEmpty.length === 0) return 'text';
  if (/url|link|analogs/i.test(label) || nonEmpty.every(looksUrl)) return 'url';
  if (nonEmpty.every(looksNumeric)) return 'number';
  return 'text';
}

/** Merge several parsed files into one library (union columns, re-index rows). */
export function mergeParsed(
  parts: { columns: ColumnDef[]; compounds: Compound[] }[],
): { columns: ColumnDef[]; compounds: Compound[] } {
  if (parts.length === 1) return parts[0];
  const colMap = new Map<string, ColumnDef>();
  for (const p of parts) {
    for (const c of p.columns) if (!colMap.has(c.key)) colMap.set(c.key, c);
  }
  const compounds: Compound[] = [];
  let idx = 0;
  for (const p of parts) {
    for (const c of p.compounds) compounds.push({ ...c, index: idx++ });
  }
  return { columns: [...colMap.values()], compounds };
}

/** A precomputed plan for turning string rows into Compounds. */
export interface ColumnPlan {
  columns: ColumnDef[];
  colIndexByKey: { key: string; index: number; kind: ColumnKind }[];
  smilesIdx: number;
  idIdx: number;
}

/** Infer the display columns + build plan from headers and a sample of rows. */
export function inferColumns(
  headers: string[],
  sampleRows: string[][],
): ColumnPlan {
  const smilesIdx = headers.findIndex(isSmilesHeader);
  const idIdx = findIdColumn(headers);

  const columns: ColumnDef[] = [];
  const colIndexByKey: ColumnPlan['colIndexByKey'] = [];

  headers.forEach((label, i) => {
    if (i === smilesIdx) return;
    const key = label.trim();
    const kind = inferKind(label, sampleRows.map((r) => r[i] ?? ''));
    columns.push({ key, label: key, kind });
    colIndexByKey.push({ key, index: i, kind });
  });

  return { columns, colIndexByKey, smilesIdx, idIdx };
}

/** Build a single Compound from a string row using a column plan. */
export function buildRow(
  plan: ColumnPlan,
  row: string[],
  rowIdx: number,
): Compound {
  const props: Record<string, number | string> = {};
  for (const { key, index, kind } of plan.colIndexByKey) {
    const raw = row[index] ?? '';
    props[key] = kind === 'number' && raw.trim() !== '' ? Number(raw) : raw;
  }
  const id =
    plan.idIdx >= 0 && row[plan.idIdx]?.trim()
      ? row[plan.idIdx].trim()
      : `row-${rowIdx}`;
  return {
    index: rowIdx,
    id,
    smiles: plan.smilesIdx >= 0 ? (row[plan.smilesIdx] ?? '').trim() : '',
    props,
  };
}

/**
 * Build columns + all compounds from a header list and string rows (in-memory).
 * Used by the SDF loader; CSV/SMILES use the streaming path.
 */
export function buildCompounds(
  headers: string[],
  rows: string[][],
): { columns: ColumnDef[]; compounds: Compound[] } {
  const plan = inferColumns(headers, rows.slice(0, 200));
  const compounds = rows.map((row, i) => buildRow(plan, row, i));
  return { columns: plan.columns, compounds };
}
