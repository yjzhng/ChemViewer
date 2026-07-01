/**
 * Directory loading: pick a folder, detect the best library file, parse it.
 *
 * Web has no access to absolute paths, so loading is user-driven: the File
 * System Access API (`showDirectoryPicker`) when available, otherwise a
 * `<input type="file" webkitdirectory>` fallback handled by the caller.
 */
import { parseCsv } from './csv';
import { parseSmiles } from './smiles';
import { parseSdf } from './sdf';
import { streamDelimited } from './stream';
import { mergeParsed } from './shared';
import type { Library, SourceFormat } from '../types';

export interface PickedDirectory {
  name: string;
  files: File[];
}

interface DirectoryPickerWindow {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

export function supportsDirectoryPicker(): boolean {
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

/** Open the native directory picker and collect its top-level files. */
export async function pickDirectory(): Promise<PickedDirectory | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) return null;
  const handle = await picker();
  const files: File[] = [];
  // @ts-expect-error - async iterator on directory handle (lib types lag).
  for await (const entry of handle.values()) {
    if (entry.kind === 'file') {
      files.push(await entry.getFile());
    }
  }
  return { name: handle.name, files };
}

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

/** Parse raw text into columns + compounds according to its format. */
export async function parseByFormat(
  format: SourceFormat,
  text: string,
): Promise<Pick<Library, 'columns' | 'compounds'>> {
  switch (format) {
    case 'csv':
      return parseCsv(text);
    case 'sdf':
      return parseSdf(text);
    case 'smiles':
      return parseSmiles(text);
  }
}


/** Parse a picked directory into a Library, preferring the richest format. */
export async function loadLibraryFromFiles(
  picked: PickedDirectory,
): Promise<Library> {
  const { name, files } = picked;

  const readmeFile = files.find((f) => /readme/i.test(f.name));
  const readme = readmeFile ? await readmeFile.text() : undefined;

  // Prefer CSV (richest columns), then SDF, then SMILES/CXSMILES — and combine
  // ALL files of the chosen format in the folder.
  const byFmt: [SourceFormat, string[]][] = [
    ['csv', ['csv']],
    ['sdf', ['sdf', 'sd']],
    ['smiles', ['smiles', 'smi', 'cxsmiles']],
  ];
  let sourceFormat: SourceFormat | null = null;
  let chosenFiles: File[] = [];
  for (const [fmt, exts] of byFmt) {
    const matches = files.filter((f) => exts.includes(ext(f.name)));
    if (matches.length) {
      sourceFormat = fmt;
      chosenFiles = matches.sort((a, b) => a.name.localeCompare(b.name));
      break;
    }
  }
  if (!sourceFormat) {
    throw new Error(
      `No .csv, .sdf, or .smiles file found in "${name}". Found: ${files
        .map((f) => f.name)
        .join(', ') || '(empty)'}`,
    );
  }

  const parts: Pick<Library, 'columns' | 'compounds'>[] = [];
  let truncated = false;
  for (const f of chosenFiles) {
    if (sourceFormat === 'sdf') {
      parts.push(await parseSdf(await f.text()));
    } else {
      const p = await streamDelimited(f, sourceFormat);
      if (p.truncated) truncated = true;
      parts.push({ columns: p.columns, compounds: p.compounds });
    }
  }
  const parsed = mergeParsed(parts);

  return {
    // Stable id (folder name) so saved subsets reassociate across reloads.
    id: name,
    name,
    sourceFormat,
    columns: parsed.columns,
    compounds: parsed.compounds,
    backend: 'memory',
    truncated,
    readme,
  };
}

/** Build a Library from `<input webkitdirectory>` FileList (fallback path). */
export async function loadLibraryFromFileList(
  fileList: FileList,
): Promise<Library> {
  const files = Array.from(fileList);
  // Derive the directory name from the first file's relative path.
  const rel = (files[0] as File & { webkitRelativePath?: string })
    ?.webkitRelativePath;
  const name = rel ? rel.split('/')[0] : 'library';
  return loadLibraryFromFiles({ name, files });
}
