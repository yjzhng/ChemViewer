# ChemViewer desktop (Electron, from source)

A thin Electron window around the live Vite dev server — full HMR, no rebundling.
This is a **from-source dev launcher**, not a packaged/notarized app.

## Run

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
