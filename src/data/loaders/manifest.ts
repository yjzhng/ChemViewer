/**
 * Auto-scan loading: the dev/preview server scans the on-disk `library/`
 * folder and exposes it as a manifest (see the `library-server` plugin in
 * vite.config.ts). The app fetches that manifest on startup and loads sources
 * without the user having to pick a folder.
 */
import { parseByFormat } from './directory';
import { streamDelimited } from './stream';
import { mergeParsed } from './shared';
import { fetchDbMeta } from '../dbClient';
import type { ColumnDef, Compound, Library, SourceFormat } from '../types';

export interface ManifestEntry {
  name: string;
  format: SourceFormat;
  /** All files of the chosen format in the folder (combined into one library). */
  dataUrls: string[];
  /** Every (non-hidden) file detected in the folder — for the manager view. */
  files?: string[];
  /** The file names actually used as the library source (basenames). */
  sourceFiles?: string[];
  readmeUrl?: string;
  backend: 'memory' | 'duckdb';
}

/** Fetch the library manifest; returns [] if the endpoint isn't available. */
export async function fetchManifest(): Promise<ManifestEntry[]> {
  try {
    const res = await fetch('/library-manifest.json', { cache: 'no-store' });
    if (!res.ok) return [];
    return (await res.json()) as ManifestEntry[];
  } catch {
    return [];
  }
}

/** Fetch + parse a manifest entry into a Library. */
export async function loadLibraryFromManifest(
  entry: ManifestEntry,
): Promise<Library> {
  // Large libraries: query on disk via DuckDB — no compounds held in memory.
  if (entry.backend === 'duckdb') {
    const meta = await fetchDbMeta(entry.name);
    return {
      id: entry.name,
      name: entry.name,
      sourceFormat: entry.format,
      columns: meta.columns,
      compounds: [],
      backend: 'duckdb',
      total: meta.total,
      smilesKey: meta.smilesKey,
      idKey: meta.idKey,
    };
  }

  // Parse every file of the chosen format and merge into one library.
  const parts: { columns: ColumnDef[]; compounds: Compound[] }[] = [];
  let truncated = false;

  for (const url of entry.dataUrls) {
    if (entry.format === 'sdf') {
      // SDF records span multiple lines — parse the whole file (not streamed).
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${entry.name} (HTTP ${res.status})`);
      }
      parts.push(await parseByFormat('sdf', await res.text()));
    } else {
      // Stream CSV/SMILES straight from the URL, aborting at the row cap.
      const parsed = await streamDelimited(url, entry.format);
      if (parsed.truncated) truncated = true;
      parts.push({ columns: parsed.columns, compounds: parsed.compounds });
    }
  }

  const { columns, compounds } = mergeParsed(parts);

  let readme: string | undefined;
  if (entry.readmeUrl) {
    const r = await fetch(entry.readmeUrl);
    if (r.ok) readme = await r.text();
  }

  return {
    // Stable id (folder name) so saved subsets reassociate across reloads.
    id: entry.name,
    name: entry.name,
    sourceFormat: entry.format,
    columns,
    compounds,
    backend: 'memory',
    truncated,
    readme,
  };
}
