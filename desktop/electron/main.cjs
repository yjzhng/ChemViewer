// ChemViewer desktop shell — runs two ways:
//
//   • Dev (from source): the orchestrator (scripts/dev.mjs) starts Vite, then
//     launches this with VITE_DEV_URL so the window loads the live HMR server.
//   • Packaged (app.isPackaged): there is no Vite server, so we start a tiny
//     local HTTP server (electron/library-server.cjs) that serves the built
//     renderer AND reimplements the dev data layer — the library scan, raw file
//     streaming, and DuckDB query endpoints — then load that local URL.

const { app, BrowserWindow, dialog, nativeImage, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// Stable name so the user-data dir is "ChemViewer" in both modes.
app.setName('ChemViewer')

const devUrl = process.env.VITE_DEV_URL || null
const isPackaged = app.isPackaged

// Single-instance lock: focus the existing window instead of a second session.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function setDockIcon() {
  if (process.platform !== 'darwin' || !app.dock) return
  const png = path.join(__dirname, '..', 'build-resources', 'icon.png')
  if (fs.existsSync(png)) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(png))
    } catch {
      /* ignore */
    }
  }
}

let mainWindow = null

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 600,
    title: 'ChemViewer',
    backgroundColor: '#141414',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  mainWindow.loadURL(url)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// Poll a URL until it answers (dev belt-and-suspenders; orchestrator already
// waits for and identity-checks the Vite server before launching us).
async function waitForUrl(url, { tries = 80, delayMs = 250 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      await fetch(url)
      return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, delayMs))
  }
}

// ---- Packaged (production) boot ---------------------------------------------

// The user's writable library folder. Unlike dev (repo root library/), a packaged
// app's own resources are read-only, so libraries live under userData where the
// user can add their own folders. Seeded once with the bundled example library.
// The library root the app reads from. Packaged: a writable userData folder
// (the bundle is read-only). Dev: the repo's library/ (same folder the Vite
// library-server plugin scans). Both are where "Import library" writes.
function libraryRootPath() {
  return isPackaged
    ? path.join(app.getPath('userData'), 'library')
    : path.join(__dirname, '..', '..', 'library')
}

function ensureLibraryDir() {
  const libraryRoot = libraryRootPath()
  fs.mkdirSync(libraryRoot, { recursive: true })
  const seedRoot = path.join(__dirname, '..', 'library-seed')
  if (!fs.existsSync(seedRoot)) return libraryRoot
  for (const entry of fs.readdirSync(seedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dest = path.join(libraryRoot, entry.name)
    // Only seed folders the user hasn't already got — never clobber their data.
    if (!fs.existsSync(dest)) {
      fs.cpSync(path.join(seedRoot, entry.name), dest, { recursive: true })
    }
  }
  return libraryRoot
}

async function bootPackaged() {
  const { createLibraryServer } = require('./library-server.cjs')
  const libraryRoot = ensureLibraryDir()
  const cacheDir = path.join(app.getPath('userData'), '.dbcache')
  fs.mkdirSync(cacheDir, { recursive: true })
  const rendererRoot = path.join(__dirname, '..', 'renderer')
  const duckdbPath = path.join(__dirname, 'duckdb.mjs')

  const { url } = await createLibraryServer({
    rendererRoot,
    libraryRoot,
    cacheDir,
    duckdbPath,
  })
  createMainWindow(url)
  if (process.env.CHEMVIEWER_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

// ---- Dev boot ---------------------------------------------------------------

async function bootDev() {
  if (!devUrl) {
    dialog.showErrorBox(
      'ChemViewer',
      'Start the desktop app via the launcher so Vite is running:\n\n  make desktop\n\n(or: node desktop/scripts/dev.mjs)',
    )
    app.quit()
    return
  }
  await waitForUrl(devUrl)
  createMainWindow(devUrl)
  if (process.env.CHEMVIEWER_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

// ---- Import library (native pick → copy/move into the library root) ----------

// Step 1: native file dialog. Returns absolute paths + basenames (no writes yet).
ipcMain.handle('pick-library-files', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow
  const picked = await dialog.showOpenDialog(win, {
    title: 'Select library files',
    buttonLabel: 'Select',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Chemical libraries',
        extensions: ['csv', 'sdf', 'sd', 'smiles', 'smi', 'cxsmiles'],
      },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
  return {
    paths: picked.filePaths,
    names: picked.filePaths.map((p) => path.basename(p)),
  }
})

// Step 2: copy/move the picked files into library/<name>/.
ipcMain.handle('import-library-files', async (_event, opts) => {
  const { name, mode, paths } = opts || {}
  if (!Array.isArray(paths) || paths.length === 0) return { error: 'No files selected' }
  // Sanitize the user-supplied folder name (no separators / traversal).
  const safe = String(name || '')
    .replace(/[/\\]/g, '')
    .replace(/\.\.+/g, '')
    .trim()
  if (!safe) return { error: 'Please enter a library name' }
  try {
    const root = libraryRootPath()
    fs.mkdirSync(root, { recursive: true })
    const dest = path.join(root, safe)
    if (fs.existsSync(dest)) {
      return { error: `A library named “${safe}” already exists` }
    }
    fs.mkdirSync(dest, { recursive: true })
    for (const src of paths) {
      const target = path.join(dest, path.basename(src))
      if (mode === 'move') {
        try {
          fs.renameSync(src, target) // fast path (same filesystem)
        } catch {
          fs.copyFileSync(src, target) // cross-device fallback
          fs.unlinkSync(src)
        }
      } else {
        fs.copyFileSync(src, target)
      }
    }
    return { name: safe, count: paths.length }
  } catch (err) {
    return { error: String((err && err.message) || err) }
  }
})

// Permanently delete a library folder (a direct child of the library root).
ipcMain.handle('delete-library', async (_event, name) => {
  const safe = String(name || '')
    .replace(/[/\\]/g, '')
    .replace(/\.\.+/g, '')
    .trim()
  if (!safe) return { error: 'Invalid library name' }
  try {
    const root = libraryRootPath()
    const dest = path.join(root, safe)
    // Guard: only ever delete a direct child of the library root.
    if (path.dirname(dest) !== root || !fs.existsSync(dest)) {
      return { error: 'Library not found' }
    }
    fs.rmSync(dest, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { error: String((err && err.message) || err) }
  }
})

async function boot() {
  setDockIcon()
  if (isPackaged) await bootPackaged()
  else await bootDev()
}

app
  .whenReady()
  .then(boot)
  .catch((err) => {
    dialog.showErrorBox('ChemViewer failed to start', String(err?.stack || err))
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (isPackaged) bootPackaged()
    else if (devUrl) createMainWindow(devUrl)
  }
})
