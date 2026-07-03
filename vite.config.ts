import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve } from 'node:path';
import type { ServerResponse } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const libraryRoot = resolve(here, 'library');

/**
 * RDKit ships a UMD glue script + a .wasm blob. Vite can't bundle the glue, so
 * we copy both into public/rdkit/ where they're served at /rdkit/* and loaded
 * via a <script> tag in index.html (exposing window.initRDKitModule).
 */
function copyRdkitAssets(): Plugin {
  return {
    name: 'copy-rdkit-assets',
    buildStart() {
      const rdkitSrc = resolve(here, 'node_modules/@rdkit/rdkit/dist');
      const rdkitDest = resolve(here, 'public/rdkit');
      mkdirSync(rdkitDest, { recursive: true });
      for (const f of ['RDKit_minimal.js', 'RDKit_minimal.wasm']) {
        copyFileSync(resolve(rdkitSrc, f), resolve(rdkitDest, f));
      }
      // OpenChemLib conformer (PMI) needs its static resources registered.
      const oclDest = resolve(here, 'public/ocl');
      mkdirSync(oclDest, { recursive: true });
      copyFileSync(
        resolve(here, 'node_modules/openchemlib/dist/resources.json'),
        resolve(oclDest, 'resources.json'),
      );
    },
  };
}

// ---- Auto-scan of the on-disk library/ folder --------------------------------

interface ManifestEntry {
  name: string;
  format: 'csv' | 'sdf' | 'smiles';
  /** All files of the chosen format in the folder (combined into one library). */
  dataUrls: string[];
  /** Every (non-hidden) file detected in the folder — for the manager view. */
  files: string[];
  /** The file names actually used as the library source (basenames). */
  sourceFiles: string[];
  readmeUrl?: string;
  /** 'duckdb' for large files (queried on disk), 'memory' for small (streamed). */
  backend: 'memory' | 'duckdb';
}

// Files larger than this are queried via DuckDB instead of loaded in-memory.
const LARGE_BYTES = 50 * 1024 * 1024;
const dbCacheDir = resolve(here, '.dbcache');

const FORMAT_BY_EXT: Record<string, ManifestEntry['format']> = {
  csv: 'csv',
  sdf: 'sdf',
  sd: 'sdf',
  smiles: 'smiles',
  smi: 'smiles',
  cxsmiles: 'smiles',
};
// Preference order when a folder has several formats (richest first).
const FORMAT_PRIORITY: ManifestEntry['format'][] = ['csv', 'sdf', 'smiles'];

function fileUrl(dir: string, file: string): string {
  return `/library-fs/${encodeURIComponent(dir)}/${encodeURIComponent(file)}`;
}

/** Scan library/ for subfolders containing a loadable source file. */
function scanLibraries(): ManifestEntry[] {
  if (!existsSync(libraryRoot)) return [];
  const out: ManifestEntry[] = [];

  for (const dirent of readdirSync(libraryRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const files = readdirSync(resolve(libraryRoot, dirent.name)).filter(
      (f) => !f.startsWith('.'),
    );

    let chosen: { file: string; format: ManifestEntry['format'] } | null = null;
    for (const want of FORMAT_PRIORITY) {
      const hit = files.find(
        (f) => FORMAT_BY_EXT[extname(f).slice(1).toLowerCase()] === want,
      );
      if (hit) {
        chosen = { file: hit, format: want };
        break;
      }
    }
    if (!chosen) continue;

    // Combine ALL files of the chosen format in the folder.
    const chosenFiles = files
      .filter(
        (f) => FORMAT_BY_EXT[extname(f).slice(1).toLowerCase()] === chosen.format,
      )
      .sort();
    const size = chosenFiles.reduce(
      (s, f) => s + statSync(resolve(libraryRoot, dirent.name, f)).size,
      0,
    );
    const readme = files.find((f) => /readme/i.test(f));
    out.push({
      name: dirent.name,
      format: chosen.format,
      dataUrls: chosenFiles.map((f) => fileUrl(dirent.name, f)),
      files: [...files].sort(),
      sourceFiles: chosenFiles,
      readmeUrl: readme ? fileUrl(dirent.name, readme) : undefined,
      // SDF can't be queried by DuckDB's read_csv (it needs RDKit), so it's
      // always memory-backed; only large CSV/SMILES use DuckDB.
      backend:
        chosen.format !== 'sdf' && size > LARGE_BYTES ? 'duckdb' : 'memory',
    });
  }
  // Deterministic order so startup auto-load is predictable.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Resolve a library's on-disk files + format by name (for the DuckDB layer). */
function libraryByName(name: string): { filePaths: string[]; format: ManifestEntry['format'] } | null {
  const entry = scanLibraries().find((e) => e.name === name);
  if (!entry) return null;
  const filePaths = entry.dataUrls.map((u) =>
    resolve(libraryRoot, decodeURIComponent(u.replace('/library-fs/', '').split('?')[0])),
  );
  return { filePaths, format: entry.format };
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((res) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => {
      try {
        res(JSON.parse(d || '{}'));
      } catch {
        res({});
      }
    });
  });
}

// Lazily load the DuckDB module so it's only required when a /db/* route is hit.
let dbModPromise: Promise<typeof import('./server/duckdb.mjs')> | null = null;
function dbMod() {
  if (!dbModPromise) dbModPromise = import('./server/duckdb.mjs');
  return dbModPromise;
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/** Serve the library manifest + raw files from disk (dev & preview servers). */
function libraryServer(): Plugin {
  const attach = (server: ViteDevServer | { middlewares: ViteDevServer['middlewares'] }) => {
    server.middlewares.use('/library-manifest.json', (_req, res) => {
      sendJson(res as ServerResponse, scanLibraries());
    });

    // DuckDB-backed query endpoints for large libraries.
    server.middlewares.use('/db/', async (req, res) => {
      const out = res as ServerResponse;
      try {
        const orig = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '';
        const u = new URL(orig, 'http://localhost');
        const action = u.pathname.replace(/^\/db\//, '');
        const mod = await dbMod();

        if (action === 'meta') {
          const name = u.searchParams.get('lib') ?? '';
          const lib = libraryByName(name);
          if (!lib) {
            out.statusCode = 404;
            out.end('unknown library');
            return;
          }
          const meta = await mod.ensureLibrary(dbCacheDir, name, lib.filePaths, lib.format);
          sendJson(out, meta);
          return;
        }

        const body = await readJson(req as IncomingMessage);
        const name = String(body.lib ?? '');
        // Ensure the library is ingested (cheap once cached) so queries work
        // even after a server restart cleared the in-memory connection map.
        const lib = libraryByName(name);
        if (!lib) {
          out.statusCode = 404;
          out.end('unknown library');
          return;
        }
        await mod.ensureLibrary(dbCacheDir, name, lib.filePaths, lib.format);

        if (action === 'count') sendJson(out, { count: await mod.count(name, body) });
        else if (action === 'page') sendJson(out, await mod.page(name, body));
        else if (action === 'stats') sendJson(out, await mod.stats(name, body));
        else if (action === 'sample') sendJson(out, await mod.sample(name, body));
        else if (action === 'distinct') sendJson(out, await mod.distinct(name, body));
        else {
          out.statusCode = 404;
          out.end('unknown action');
        }
      } catch (err) {
        out.statusCode = 500;
        sendJson(out, { error: String((err as Error)?.message ?? err) });
      }
    });

    server.middlewares.use('/library-fs/', (req, res) => {
      const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(
        /^\/+/,
        '',
      );
      const target = resolve(libraryRoot, rel);
      // Path-traversal guard: stay within library/.
      if (!target.startsWith(libraryRoot + '/') || !existsSync(target)) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const out = res as ServerResponse;
      const stream = createReadStream(target);
      // The client aborts the request once it hits its row cap (large files);
      // tear down the read stream so we don't keep reading a 2GB file.
      out.on('close', () => stream.destroy());
      stream.on('error', () => {
        if (!out.headersSent) {
          out.statusCode = 404;
          out.end('Not found');
        } else {
          out.destroy();
        }
      });
      out.setHeader('Content-Type', 'text/plain; charset=utf-8');
      stream.pipe(out);
    });
  };

  return {
    name: 'library-server',
    configureServer: (server) => attach(server),
    configurePreviewServer: (server) => attach(server),
  };
}

export default defineConfig({
  // Ketcher (the structure sketcher) bundles Node-style code (global, process,
  // Buffer); these polyfills are what make it run in the browser under Vite.
  plugins: [
    copyRdkitAssets(),
    libraryServer(),
    react(),
    nodePolyfills({ globals: { global: true, process: true, Buffer: true } }),
  ],
  server: { port: 5173 },
  // The compute worker dynamically imports OpenChemLib, which needs code
  // splitting — only the ES worker format supports that.
  worker: { format: 'es' },
});
