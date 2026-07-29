// ChemViewer desktop shell — runs two ways:
//
//   • Dev (from source): the orchestrator (scripts/dev.mjs) starts Vite, then
//     launches this with VITE_DEV_URL so the window loads the live HMR server.
//   • Packaged (app.isPackaged): there is no Vite server, so we start a tiny
//     local HTTP server (electron/library-server.cjs) that serves the built
//     renderer AND reimplements the dev data layer — the library scan, raw file
//     streaming, and DuckDB query endpoints — then load that local URL.

const { app, BrowserWindow, dialog, nativeImage } = require('electron')
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
    backgroundColor: '#15171c',
    webPreferences: { contextIsolation: true },
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
function ensureLibraryDir() {
  const libraryRoot = path.join(app.getPath('userData'), 'library')
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
