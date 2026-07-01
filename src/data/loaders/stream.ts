/**
 * Streaming delimited-text loader (CSV / SMILES / CXSMILES).
 *
 * Reads the source as a byte stream (fetch body for URLs, File.stream() for
 * picked files), parses line-by-line, and stops once a row cap is reached by
 * cancelling the reader — which aborts the network transfer / file read and
 * frees its buffers. This keeps multi-gigabyte files (e.g. Enamine REAL) from
 * ever being held in memory.
 *
 * Fields may be double-quoted (CSV exports quote SMILES whose CXSMILES stereo
 * block contains commas, e.g. `"...|&1:2,4,r|"`), so splitting is quote-aware.
 * It assumes fields don't contain newlines, which holds for SMILES/CXSMILES and
 * the chemistry CSVs we target.
 */
import { inferColumns, isSmilesHeader, buildRow, type ColumnPlan } from './shared';
import type { ColumnDef, Compound, SourceFormat } from '../types';

/** Split a line into fields, honoring double-quoted fields and "" escapes. */
function splitFields(line: string, delim: string): string[] {
  if (line.indexOf('"') === -1) return line.split(delim);
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Index of the next record-terminating '\n' (one that is NOT inside a quoted
 * field), or -1. Quoted fields may contain commas AND newlines (e.g. MCE CSVs
 * with multi-line description columns), so records can span physical lines.
 */
function findRecordEnd(s: string): number {
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (inQuotes && s[i + 1] === '"') i++; // escaped quote
      else inQuotes = !inQuotes;
    } else if (ch === '\n' && !inQuotes) {
      return i;
    }
  }
  return -1;
}

/** Max compounds held in the browser; larger libraries are truncated. */
export const MAX_ROWS = 300_000;

const SAMPLE = 200;

export interface StreamResult {
  columns: ColumnDef[];
  compounds: Compound[];
  truncated: boolean;
}

async function getByteStream(
  input: File | string,
): Promise<ReadableStream<Uint8Array>> {
  if (typeof input !== 'string') return input.stream();
  const res = await fetch(input);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch (HTTP ${res.status})`);
  }
  return res.body;
}

export async function streamDelimited(
  input: File | string,
  format: SourceFormat,
  cap = MAX_ROWS,
): Promise<StreamResult> {
  const reader = (await getByteStream(input)).getReader();
  const decoder = new TextDecoder();

  let delimiter = format === 'csv' ? ',' : '\t';
  let headers: string[] | null = null;
  let plan: ColumnPlan | null = null;
  let outColumns: ColumnDef[] = [];
  const buffer: string[][] = [];
  const compounds: Compound[] = [];
  let rowIdx = 0;
  let truncated = false;
  let firstLine = true;

  const flushBuffer = () => {
    if (!headers) return;
    const p = inferColumns(headers, buffer);
    plan = p;
    outColumns = p.columns;
    for (const b of buffer) compounds.push(buildRow(p, b, rowIdx++));
    buffer.length = 0;
  };

  const processLine = (rawLine: string) => {
    let line = rawLine;
    if (firstLine) {
      firstLine = false;
      line = line.replace(/^﻿/, ''); // strip UTF-8 BOM
      const sep = /^sep=(.)$/i.exec(line.trim());
      if (sep) {
        delimiter = sep[1] === '\\t' ? '\t' : sep[1];
        return; // skip the Excel directive line
      }
    }
    const row = splitFields(line, delimiter);
    if (!headers) {
      const isHdr = format === 'csv' ? true : row.some(isSmilesHeader);
      headers = isHdr
        ? row.map(String)
        : ['SMILES', ...row.slice(1).map((_, i) => `field_${i + 1}`)];
      if (!isHdr) buffer.push(row);
      return;
    }
    if (!plan) {
      buffer.push(row);
      if (buffer.length >= SAMPLE) flushBuffer();
      return;
    }
    compounds.push(buildRow(plan, row, rowIdx++));
  };

  let textBuf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      textBuf += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = findRecordEnd(textBuf)) >= 0) {
        let line = textBuf.slice(0, nl);
        textBuf = textBuf.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line !== '') processLine(line);

        if (compounds.length >= cap) {
          truncated = true;
          await reader.cancel().catch(() => {});
          if (!plan) flushBuffer();
          return { columns: outColumns, compounds, truncated };
        }
      }
    }
    // Final partial line (no trailing newline).
    const last = textBuf.trim();
    if (last !== '') processLine(last);
  } finally {
    reader.releaseLock();
  }

  if (!plan) flushBuffer();
  return { columns: outColumns, compounds, truncated };
}
