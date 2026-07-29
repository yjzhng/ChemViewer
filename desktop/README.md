# ChemViewer desktop (Electron)

Two modes:

- **Dev (from source)** — a thin Electron window around the live Vite dev server
  (full HMR, no rebundling). See below.
- **Packaged app (DMG)** — a standalone, distributable build with the data layer
  (library scan, file streaming, DuckDB) reimplemented in the main process. See
  [Packaged app / DMG](#packaged-app--dmg).

## Run (dev)

From the repo root:

```sh
make desktop
# or
npm run desktop
# or
node desktop/scripts/dev.mjs
```

First run installs Electron into `desktop/node_modules` (one-time, ~100 MB).
Make sure the root web deps are installed too (`npm install` in the repo root).

## Host port guard

To stop one app's session mixing with a sibling Electron app's:

1. **Unique base port + identity check.** Vite is launched on `5373` (uniOme uses
   5173, autumnLab 5273) with `strictPort` off, so a busy port auto-increments.
   Before launching the window, the orchestrator fetches the bound URL and
   requires the served HTML to be ChemViewer — if another app's server answers,
   it refuses to launch. Override the base port with `CHEMVIEWER_PORT`.
2. **Branded Electron clone (macOS).** An unpackaged Electron run otherwise uses
   the shared `com.github.Electron` bundle id, so sibling apps collide in Launch
   Services. We make a cheap APFS clone branded with a unique bundle id
   (`tech.yjzhng.chemviewer`). Disable with `CHEMVIEWER_NO_BRAND=1`.

## Env toggles

| Var | Effect |
| --- | --- |
| `CHEMVIEWER_PORT` | Base Vite port (default 5373). |
| `CHEMVIEWER_DEVTOOLS=1` | Open DevTools (detached) on launch. |
| `CHEMVIEWER_NO_BRAND=1` | Skip the macOS branded-Electron clone. |

## Notes

- The window loads the Vite server, so the on-disk `library/` scan (the
  `library-server` Vite plugin) and RDKit WASM work exactly as in the browser.
- Optional branding assets: drop `build-resources/icon.png` (dock) and
  `build-resources/icon.icns` (app clone) to brand the icon.

## Packaged app / DMG

Build a standalone, distributable macOS app:

```sh
npm --prefix desktop run dist    # → desktop/release/ChemViewer-<version>-arm64.dmg
```

[`scripts/build-dmg.mjs`](scripts/build-dmg.mjs) builds the renderer (`vite
build`), stages it plus the DuckDB backend and the seed example library into
`desktop/`, then runs electron-builder ([`electron-builder.cjs`](electron-builder.cjs)).

How the packaged app differs from dev — since there's no Vite server,
[`electron/main.cjs`](electron/main.cjs) starts a local HTTP server
([`electron/library-server.cjs`](electron/library-server.cjs)) that serves the
built renderer **and** reimplements the dev data layer: the `library-manifest`
scan, `/library-fs/*` file streaming, and `/db/*` DuckDB queries (native
`@duckdb/node-api`). The user's libraries live under
`~/Library/Application Support/ChemViewer/library/` (writable, unlike the app
bundle) and are seeded once with the bundled example library; drop more folders
there to add libraries.

Caveats:

- **arm64 only.** The config targets Apple Silicon. For Intel, add `x64` to
  `mac.target[].arch` in `electron-builder.cjs` and build on / for that arch
  (the DuckDB native binding is per-arch).
- **Not notarized.** The app is ad-hoc signed (no Apple Developer ID), so it
  launches but Gatekeeper warns on first open. Users: right-click → **Open**, or
  `xattr -dr com.apple.quarantine /Applications/ChemViewer.app`.
- `asar` is disabled on purpose so the native DuckDB module and the ESM backend
  resolve as plain files.

### GitHub release

Attach `desktop/release/ChemViewer-<version>-arm64.dmg` to the release. The
`.dmg.blockmap` next to it is only needed if you later wire up electron-updater.
