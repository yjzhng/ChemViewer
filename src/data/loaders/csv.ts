/** CSV loader. Handles Excel-style `sep=,` preamble lines (Enamine exports). */
import Papa from 'papaparse';
import { buildCompounds } from './shared';
import type { ColumnDef, Compound } from '../types';

export function parseCsv(text: string): {
  columns: ColumnDef[];
  compounds: Compound[];
} {
  // Strip a leading `sep=,` / `sep=\t` directive line if present.
  let body = text;
  const firstNewline = text.indexOf('\n');
  const firstLine = (firstNewline === -1 ? text : text.slice(0, firstNewline)).trim();
  let delimiter: string | undefined;
  const sepMatch = /^sep=(.)$/i.exec(firstLine);
  if (sepMatch) {
    delimiter = sepMatch[1] === '\\t' ? '\t' : sepMatch[1];
    body = text.slice(firstNewline + 1);
  }

  const parsed = Papa.parse<string[]>(body, {
    delimiter,
    skipEmptyLines: true,
  });

  const rows = parsed.data.filter((r) => Array.isArray(r) && r.length > 0);
  if (rows.length === 0) return { columns: [], compounds: [] };

  const headers = rows[0].map((h) => String(h));
  return buildCompounds(headers, rows.slice(1));
}
