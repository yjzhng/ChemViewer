// Build a distributable ChemViewer DMG (production, packaged app).
//
//   npm run dist            (from desktop/, or: node desktop/scripts/build-dmg.mjs)
//
// Steps:
//   1. Build the renderer at the repo root (vite build → dist/).
//   2. Stage the packaged-app payload into desktop/:
//        dist/                  → desktop/renderer/          (built UI + assets)
//        server/duckdb.mjs      → desktop/electron/duckdb.mjs (DuckDB backend)
//        library/Example-drug-library → desktop/library-seed/… (bundled example)
//   3. Run electron-builder → desktop/release/ContainerViewer*.dmg
//
// The staged copies are build artifacts (git-ignored); electron/main.cjs reads
// them at runtime in the packaged app.

import { execFileSync } from 'node:child_process'
import { rmSync, mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = resolve(here, '..')
const repo = resolve(desktop, '..')

const run = (cmd, args, cwd, extraEnv = {}) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...extraEnv } })

// 1. Build the renderer.
console.log('[dmg] building renderer (npm run build)…')
run('npm', ['run', 'build'], repo)

const dist = resolve(repo, 'dist')
if (!existsSync(dist)) {
  console.error('[dmg] repo/dist not found after build — aborting')
  process.exit(1)
}

// 2. Stage the payload into desktop/.
console.log('[dmg] staging renderer, DuckDB backend, and seed library…')
const rendererDest = resolve(desktop, 'renderer')
rmSync(rendererDest, { recursive: true, force: true })
cpSync(dist, rendererDest, { recursive: true })

cpSync(resolve(repo, 'server/duckdb.mjs'), resolve(desktop, 'electron/duckdb.mjs'))

const seedDest = resolve(desktop, 'library-seed')
rmSync(seedDest, { recursive: true, force: true })
mkdirSync(seedDest, { recursive: true })
const exampleSrc = resolve(repo, 'library/Example-drug-library')
if (existsSync(exampleSrc)) {
  cpSync(exampleSrc, resolve(seedDest, 'Example-drug-library'), { recursive: true })
} else {
  console.warn('[dmg] warning: example library not found at', exampleSrc)
}

// 3. Package.
console.log('[dmg] running electron-builder…')
const builderBin = resolve(desktop, 'node_modules/.bin/electron-builder')
run(builderBin, ['--config', 'electron-builder.cjs'], desktop, {
  // No Developer ID: don't let electron-builder hunt for a signing cert.
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
})

const release = resolve(desktop, 'release')
console.log('\n[dmg] done. Artifacts in desktop/release/:')
if (existsSync(release)) {
  for (const f of readdirSync(release).filter((f) => f.endsWith('.dmg'))) {
    console.log('   •', f)
  }
}
