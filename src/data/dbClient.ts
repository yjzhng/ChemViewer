/**
 * Client for the DuckDB-backed query endpoints (large libraries served from
 * disk by the Vite plugin). All browsing/filtering/stats for these libraries
 * go through here — the renderer never holds the full set.
 */
import type { ColumnDef, Compound, FilterRule } from './types';

export interface DbMeta {
  name: string;
  columns: ColumnDef[];
  total: number;
  smilesKey: string | null;
  idKey: string | null;
  numericKeys: string[];
}

export interface DbColumnStats {
  key: string;
  label: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  bins: number[];
}

export interface DbStats {
  count: number;
  columns: DbColumnStats[];
}

export interface DbQuery {
  rules: FilterRule[];
  globalSearch: string;
}

async function post<T>(action: string, body: unknown): Promise<T> {
  const res = await fetch(`/db/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`/db/${action} failed (${res.status})`);
  return res.json() as Promise<T>;
}

export async function fetchDbMeta(lib: string): Promise<DbMeta> {
  const res = await fetch(`/db/meta?lib=${encodeURIComponent(lib)}`);
  if (!res.ok) throw new Error(`Could not load ${lib} (${res.status})`);
  return res.json() as Promise<DbMeta>;
}

export function dbCount(lib: string, q: DbQuery): Promise<{ count: number }> {
  return post('count', { lib, ...q });
}

export function dbPage(
  lib: string,
  q: DbQuery & {
    orderBy?: string;
    dir?: 'asc' | 'desc';
    offset: number;
    limit: number;
  },
): Promise<Compound[]> {
  return post('page', { lib, ...q });
}

export function dbStats(lib: string, q: DbQuery): Promise<DbStats> {
  return post('stats', { lib, ...q });
}

/** A random sample of compounds (SMILES + id) for fingerprint clustering. */
export function dbSample(lib: string, q: DbQuery, n: number): Promise<Compound[]> {
  return post('sample', { lib, ...q, n });
}

export interface DistinctValues {
  values: { value: string; count: number }[];
  capped: boolean;
}

/** Distinct values of a column for the categorical "is" filter. */
export function dbDistinct(lib: string, column: string): Promise<DistinctValues> {
  return post('distinct', { lib, column });
}
