// ChemViewer desktop shell. A thin Electron window that loads the live Vite dev
// server (HMR) — so frontend edits hot-reload with no rebundling. The dev
// orchestrator (scripts/dev.mjs) starts Vite, verifies the served page is
// actually ChemViewer (port guard), then launches this with VITE_DEV_URL.
//
// This is a from-source dev launcher, not a packaged app.

const { app, BrowserWindow, dialog, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

// Stable name so the user-data dir is "ChemViewer" even in the from-source run.
app.setName('ChemViewer')

const devUrl = process.env.VITE_DEV_URL || null

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

// Poll a URL until it answers (belt-and-suspenders; the orchestrator already
// waits for — and identity-checks — the Vite server before launching us).
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

async function boot() {
  setDockIcon()
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
  // DevTools stay hidden on launch; opt in with CHEMVIEWER_DEVTOOLS=1.
  if (process.env.CHEMVIEWER_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
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
  if (devUrl && BrowserWindow.getAllWindows().length === 0) {
    createMainWindow(devUrl)
  }
})
