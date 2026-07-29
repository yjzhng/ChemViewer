// Production backend for the packaged ChemViewer app.
//
// In dev, ChemViewer's data layer is a Vite middleware plugin (see the repo's
// vite.config.ts `libraryServer`): it scans the on-disk library/ folder, serves
// the manifest, streams raw files, and answers DuckDB queries for large files.
// A packaged app has no Vite server, so this module reimplements that exact
// surface as a tiny local HTTP server that also serves the built renderer, so
// the renderer's absolute fetches (/library-manifest.json, /db/*, /library-fs/*,
// /rdkit/*, /assets/*) resolve identically to dev.

const http = require('node:http')
const {
  createReadStream,
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
} = require('node:fs')
const { extname, resolve, join } = require('node:path')
const { pathToFileURL } = require('node:url')

// ---- Library scan (mirrors vite.config.ts) ----------------------------------

const LARGE_BYTES = 50 * 1024 * 1024

const FORMAT_BY_EXT = {
  csv: 'csv',
  sdf: 'sdf',
  sd: 'sdf',
  smiles: 'smiles',
  smi: 'smiles',
  cxsmiles: 'smiles',
}
const FORMAT_PRIORITY = ['csv', 'sdf', 'smiles']

function fileUrl(dir, file) {
  return `/library-fs/${encodeURIComponent(dir)}/${encodeURIComponent(file)}`
}

function scanLibraries(libraryRoot) {
  if (!existsSync(libraryRoot)) return []
  const out = []
  for (const dirent of readdirSync(libraryRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const files = readdirSync(resolve(libraryRoot, dirent.name)).filter(
      (f) => !f.startsWith('.'),
    )
    let chosen = null
    for (const want of FORMAT_PRIORITY) {
      const hit = files.find(
        (f) => FORMAT_BY_EXT[extname(f).slice(1).toLowerCase()] === want,
      )
      if (hit) {
        chosen = { file: hit, format: want }
        break
      }
    }
    if (!chosen) continue
    const chosenFiles = files
      .filter(
        (f) => FORMAT_BY_EXT[extname(f).slice(1).toLowerCase()] === chosen.format,
      )
      .sort()
    const size = chosenFiles.reduce(
      (s, f) => s + statSync(resolve(libraryRoot, dirent.name, f)).size,
      0,
    )
    const readme = files.find((f) => /readme/i.test(f))
    out.push({
      name: dirent.name,
      format: chosen.format,
      dataUrls: chosenFiles.map((f) => fileUrl(dirent.name, f)),
      files: [...files].sort(),
      sourceFiles: chosenFiles,
      readmeUrl: readme ? fileUrl(dirent.name, readme) : undefined,
      backend:
        chosen.format !== 'sdf' && size > LARGE_BYTES ? 'duckdb' : 'memory',
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function libraryByName(libraryRoot, name) {
  const entry = scanLibraries(libraryRoot).find((e) => e.name === name)
  if (!entry) return null
  const filePaths = entry.dataUrls.map((u) =>
    resolve(
      libraryRoot,
      decodeURIComponent(u.replace('/library-fs/', '').split('?')[0]),
    ),
  )
  return { filePaths, format: entry.format }
}

// ---- HTTP helpers -----------------------------------------------------------

function readJson(req) {
  return new Promise((res) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => {
      try {
        res(JSON.parse(d || '{}'))
      } catch {
        res({})
      }
    })
  })
}

function sendJson(res, body) {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

// ---- Server -----------------------------------------------------------------

/**
 * Start the local backend + static renderer server.
 * @returns {Promise<{url: string, server: import('http').Server}>}
 */
function createLibraryServer({ rendererRoot, libraryRoot, cacheDir, duckdbPath }) {
  // Lazily import the ESM DuckDB layer only when a /db/* route is hit.
  let dbModPromise = null
  const dbMod = () => {
    if (!dbModPromise) dbModPromise = import(pathToFileURL(duckdbPath).href)
    return dbModPromise
  }

  const serveStatic = (urlPath, res) => {
    // Map "/" -> index.html; otherwise the requested file under rendererRoot.
    let rel = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '')
    if (rel === '') rel = 'index.html'
    let target = resolve(rendererRoot, rel)
    // Path-traversal guard.
    if (target !== rendererRoot && !target.startsWith(rendererRoot + '/')) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }
    // SPA fallback: unknown, extension-less routes serve index.html.
    if (!existsSync(target) || statSync(target).isDirectory()) {
      if (extname(target)) {
        res.statusCode = 404
        res.end('Not found')
        return
      }
      target = resolve(rendererRoot, 'index.html')
    }
    res.setHeader('Content-Type', MIME[extname(target).toLowerCase()] || 'application/octet-stream')
    const stream = createReadStream(target)
    res.on('close', () => stream.destroy())
    stream.on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 404
        res.end('Not found')
      } else res.destroy()
    })
    stream.pipe(res)
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/'

    // ---- manifest --------------------------------------------------------
    if (url === '/library-manifest.json' || url.startsWith('/library-manifest.json?')) {
      sendJson(res, scanLibraries(libraryRoot))
      return
    }

    // ---- DuckDB query endpoints -----------------------------------------
    if (url.startsWith('/db/')) {
      try {
        const u = new URL(url, 'http://localhost')
        const action = u.pathname.replace(/^\/db\//, '')
        const mod = await dbMod()

        if (action === 'meta') {
          const name = u.searchParams.get('lib') || ''
          const lib = libraryByName(libraryRoot, name)
          if (!lib) {
            res.statusCode = 404
            res.end('unknown library')
            return
          }
          const meta = await mod.ensureLibrary(cacheDir, name, lib.filePaths, lib.format)
          sendJson(res, meta)
          return
        }

        const body = await readJson(req)
        const name = String(body.lib || '')
        const lib = libraryByName(libraryRoot, name)
        if (!lib) {
          res.statusCode = 404
          res.end('unknown library')
          return
        }
        await mod.ensureLibrary(cacheDir, name, lib.filePaths, lib.format)

        if (action === 'count') sendJson(res, { count: await mod.count(name, body) })
        else if (action === 'page') sendJson(res, await mod.page(name, body))
        else if (action === 'stats') sendJson(res, await mod.stats(name, body))
        else if (action === 'sample') sendJson(res, await mod.sample(name, body))
        else if (action === 'distinct') sendJson(res, await mod.distinct(name, body))
        else {
          res.statusCode = 404
          res.end('unknown action')
        }
      } catch (err) {
        res.statusCode = 500
        sendJson(res, { error: String((err && err.message) || err) })
      }
      return
    }

    // ---- raw library files ----------------------------------------------
    if (url.startsWith('/library-fs/')) {
      const rel = decodeURIComponent(url.replace(/^\/library-fs\//, '').split('?')[0]).replace(/^\/+/, '')
      const target = resolve(libraryRoot, rel)
      if (!target.startsWith(libraryRoot + '/') || !existsSync(target)) {
        res.statusCode = 404
        res.end('Not found')
        return
      }
      const stream = createReadStream(target)
      res.on('close', () => stream.destroy())
      stream.on('error', () => {
        if (!res.headersSent) {
          res.statusCode = 404
          res.end('Not found')
        } else res.destroy()
      })
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      stream.pipe(res)
      return
    }

    // ---- built renderer + static assets ---------------------------------
    serveStatic(url, res)
  })

  return new Promise((resolveServer, reject) => {
    server.once('error', reject)
    // Ephemeral port on loopback only.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolveServer({ url: `http://127.0.0.1:${port}`, server })
    })
  })
}

module.exports = { createLibraryServer, scanLibraries }
