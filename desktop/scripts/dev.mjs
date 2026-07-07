// ChemViewer desktop dev loop — a live from-source Electron window around the
// Vite UI (HMR, no rebundling). Quitting the window ends the session.
//
//   make desktop            (or: node desktop/scripts/dev.mjs)
//
// HOST PORT GUARD — two defenses so one app's session never mixes with another
// sibling Electron app's:
//   1. Vite is launched on a base port UNIQUE to ChemViewer (5373; uniOme uses
//      5173, autumnLab 5273) with strictPort OFF, so a busy port auto-increments
//      and we point Electron at whatever Vite actually bound. Before launching,
//      we fetch that URL and require the served HTML to be ChemViewer — if some
//      OTHER app's server answers, we refuse to launch.
//   2. On macOS, an unpackaged Electron run shows the stock "Electron" identity,
//      and the default bundle id (com.github.Electron) is shared, so two sibling
//      apps collide in Launch Services and one can launch the other. We brand a
//      cheap APFS clone with a UNIQUE bundle id (tech.yjzhng.chemviewer).

import { spawn, execFileSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  copyFileSync,
  mkdirSync,
} from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = resolve(here, '..')
const repo = resolve(desktop, '..') // ChemViewer root = the Vite app

const APP_NAME = 'ChemViewer'
const BASE_PORT = String(process.env.CHEMVIEWER_PORT || 5373)

const viteBin = resolve(repo, 'node_modules/.bin/vite')
const electronBinDefault = resolve(desktop, 'node_modules/.bin/electron')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// macOS branded Electron clone with a UNIQUE bundle id (see header, defense #2).
const BRAND_ID = 'tech.yjzhng.chemviewer'
const BRAND_REV = '1' // bump to force a re-brand when this logic changes
function brandedElectronBin() {
  if (process.platform !== 'darwin' || process.env.CHEMVIEWER_NO_BRAND === '1') {
    return null
  }
  try {
    const stock = resolve(desktop, 'node_modules/electron/dist/Electron.app')
    if (!existsSync(stock)) return null
    const ver = JSON.parse(
      readFileSync(resolve(desktop, 'node_modules/electron/package.json'), 'utf8'),
    ).version
    const branded = resolve(desktop, `build/${APP_NAME}.app`)
    const marker = resolve(desktop, 'build/.electron-brand')
    const want = `${ver}:${BRAND_REV}`
    const cur = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : ''
    if (cur !== want || !existsSync(branded)) {
      console.log(`[dev] branding Electron → ${APP_NAME} (one-time)…`)
      mkdirSync(resolve(desktop, 'build'), { recursive: true })
      rmSync(branded, { recursive: true, force: true })
      execFileSync('cp', ['-Rc', stock, branded]) // APFS copy-on-write clone
      execFileSync('/usr/libexec/PlistBuddy', [
        '-c', `Set :CFBundleName ${APP_NAME}`,
        '-c', `Set :CFBundleDisplayName ${APP_NAME}`,
        '-c', `Set :CFBundleIdentifier ${BRAND_ID}`,
        resolve(branded, 'Contents/Info.plist'),
      ])
      const icns = resolve(desktop, 'build-resources/icon.icns')
      if (existsSync(icns)) {
        copyFileSync(icns, resolve(branded, 'Contents/Resources/electron.icns'))
      }
      execFileSync('codesign', ['--force', '--sign', '-', branded], {
        stdio: 'ignore',
      }) // ad-hoc re-sign
      writeFileSync(marker, want)
    }
    execFileSync('codesign', ['--verify', branded], { stdio: 'ignore' })
    const exe = resolve(branded, 'Contents/MacOS/Electron')
    return existsSync(exe) ? exe : null
  } catch (e) {
    console.warn('[dev] Electron branding failed, using stock:', e.message)
    return null
  }
}

const children = []
let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// Defense #1: wait until the URL serves OUR app — not just "something answers".
async function waitForChemViewer(url, tries = 160, delay = 300) {
  for (let i = 0; i < tries; i++) {
    try {
      const text = await (await fetch(url)).text()
      if (text.includes(APP_NAME)) return
      console.error(
        `[dev] ${url} answered but is not ${APP_NAME} (port conflict?) — refusing to launch`,
      )
      shutdown(1)
    } catch {
      /* not up yet */
    }
    await sleep(delay)
  }
  console.error(`[dev] ${url} did not come up`)
  shutdown(1)
}

// Start Vite on our unique base port (strictPort OFF) and resolve the ACTUAL
// URL it bound, so a busy port auto-increments instead of failing the launch.
function startVite() {
  return new Promise((resolveUrl, reject) => {
    const child = spawn(viteBin, ['--host', '127.0.0.1', '--port', BASE_PORT], {
      cwd: repo,
      detached: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(child)
    let done = false
    const scan = (buf) => {
      const s = buf.toString()
      process.stdout.write(s) // tee Vite's logs through
      const m = s.match(/http:\/\/127\.0\.0\.1:(\d+)/)
      if (m && !done) {
        done = true
        resolveUrl(`http://127.0.0.1:${m[1]}`)
      }
    }
    child.stdout.on('data', scan)
    child.stderr.on('data', scan)
    child.on('exit', (code) => {
      if (!done) reject(new Error(`Vite exited (code ${code}) before serving`))
    })
  })
}

console.log(`[dev] starting Vite (base :${BASE_PORT}) + Electron…`)

let webUrl
try {
  webUrl = await startVite()
} catch (e) {
  console.error('[dev]', e.message)
  shutdown(1)
}

await waitForChemViewer(webUrl)

const electronEnv = { ...process.env, VITE_DEV_URL: webUrl }
delete electronEnv.ELECTRON_RUN_AS_NODE // some shells set this; makes electron run as plain node
const electronBin = brandedElectronBin() || electronBinDefault
const electron = spawn(electronBin, ['.'], {
  cwd: desktop,
  stdio: 'inherit',
  detached: true,
  env: electronEnv,
})
children.push(electron)
electron.on('exit', (code) => shutdown(code ?? 0)) // quitting the app ends the session
