/**
 * SDF loader. Records are separated by `$$$$`; each is a molblock followed by
 * `> <Field>` / value data items. Molblocks are converted to SMILES via RDKit.
 */
import { getRDKit } from '../../chem/rdkit';
import { buildCompounds } from './shared';
import type { ColumnDef, Compound } from '../types';

interface RawRecord {
  molblock: string;
  fields: Record<string, string>;
}

function parseFields(tail: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const re = />\s*<([^>]+)>[^\n]*\n([\s\S]*?)(?=\n>\s*<|\n*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail)) !== null) {
    fields[m[1].trim()] = m[2].trim();
  }
  return fields;
}

function splitRecords(text: string): RawRecord[] {
  return text
    .split(/\$\$\$\$\r?\n?/)
    // Keep each chunk verbatim: a molblock's first line is the (often empty)
    // molecule name — stripping a leading newline shifts the counts line and
    // breaks parsing.
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      // The molblock ends at the "M  END" line; data items follow.
      const endIdx = chunk.indexOf('M  END');
      if (endIdx === -1) return { molblock: chunk, fields: {} };
      const molEnd = chunk.indexOf('\n', endIdx);
      return {
        molblock: chunk.slice(0, molEnd === -1 ? chunk.length : molEnd),
        fields: parseFields(chunk.slice(molEnd === -1 ? chunk.length : molEnd)),
      };
    });
}

export async function parseSdf(text: string): Promise<{
  columns: ColumnDef[];
  compounds: Compound[];
}> {
  const records = splitRecords(text);
  if (records.length === 0) return { columns: [], compounds: [] };
  const rdkit = await getRDKit();

  // Union of all field names becomes the column set (+ SMILES from molblock).
  const fieldNames: string[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    for (const k of Object.keys(rec.fields)) {
      if (!seen.has(k)) {
        seen.add(k);
        fieldNames.push(k);
      }
    }
  }

  const headers = ['SMILES', ...fieldNames];
  // Convert molblock → SMILES in chunks, yielding between them so the main
  // thread can paint the "Loading…" state (large multi-file SDFs are slow).
  const rows: string[][] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const mol = rdkit.get_mol(rec.molblock);
    let smiles = '';
    try {
      if (mol && mol.is_valid()) smiles = mol.get_smiles();
    } finally {
      mol?.delete();
    }
    rows.push([smiles, ...fieldNames.map((f) => rec.fields[f] ?? '')]);
    if ((i & 1023) === 1023) await new Promise((r) => setTimeout(r));
  }

  return buildCompounds(headers, rows);
}
