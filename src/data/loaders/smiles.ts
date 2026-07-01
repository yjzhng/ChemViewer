/**
 * SMILES-file loader. Whitespace-delimited (tab or spaces); the bundled Enamine
 * `.smiles` file is tab-delimited with a header row matching the CSV columns.
 */
import { buildCompounds } from './shared';
import { isSmilesHeader } from './shared';
import type { ColumnDef, Compound } from '../types';

function splitLine(line: string): string[] {
  // Prefer tabs; fall back to runs of whitespace.
  return line.includes('\t') ? line.split('\t') : line.trim().split(/\s+/);
}

export function parseSmiles(text: string): {
  columns: ColumnDef[];
  compounds: Compound[];
} {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { columns: [], compounds: [] };

  const firstCells = splitLine(lines[0]);
  const hasHeader = firstCells.some(isSmilesHeader);

  const headers = hasHeader
    ? firstCells
    : ['SMILES', ...firstCells.slice(1).map((_, i) => `field_${i + 1}`)];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const rows = dataLines.map(splitLine);
  return buildCompounds(headers, rows);
}
