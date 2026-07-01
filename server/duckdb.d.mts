export interface DbMeta {
  name: string;
  columns: { key: string; label: string; kind: 'number' | 'text' }[];
  total: number;
  smilesKey: string | null;
  idKey: string | null;
  numericKeys: string[];
}

export function ensureLibrary(
  cacheDir: string,
  name: string,
  filePaths: string[],
  format: string,
): Promise<DbMeta>;

export function count(name: string, body: unknown): Promise<number>;
export function page(name: string, body: unknown): Promise<unknown[]>;
export function stats(name: string, body: unknown): Promise<unknown>;
export function sample(name: string, body: unknown): Promise<unknown[]>;
export function distinct(
  name: string,
  body: unknown,
): Promise<{ values: { value: string; count: number }[]; capped: boolean }>;
