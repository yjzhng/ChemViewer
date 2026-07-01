# ChemViewer

Interactive browser for chemical libraries — load CSV/SDF/SMILES/CXSMILES,
browse a fast virtualized table with rendered structures, filter/search, save
selections as subsets, and view chemoinformatic stats. Runs in the browser or
as a from-source Electron desktop app.

## Quick start

```sh
npm install         # or: make install
npm run dev         # browser dev server (http://localhost:5173)
```

Drop library folders into `library/` (each subfolder with a `.csv`, `.sdf`,
`.smiles`, or `.cxsmiles` file). They're auto-discovered on startup.

## Desktop app (Electron, from source)

```sh
make desktop        # Vite + a native window, with the host port guard
```

Or double-click **ChemViewer.app** in the repo (first run installs deps).
See [desktop/README.md](desktop/README.md) for the port guard and env toggles.

## Stack

- **Vite + React + TypeScript** — UI and virtualized table (TanStack Table/Virtual).
- **RDKit (WASM)** — 2D depiction, descriptors, fingerprints, substructure search.
- **Electron** — from-source desktop shell around the live Vite server.

## Layout

| Path | What |
| --- | --- |
| `src/` | App source (components, chem, data loaders, stats, filters). |
| `library/` | Chemical libraries, auto-scanned by the dev server. |
| `desktop/` | Electron shell + dev orchestrator (`make desktop`). |
| `ChemViewer.app` | Double-clickable macOS launcher (hands off to `desktop/`). |
| `vite.config.ts` | Vite config + RDKit-asset and library-scan plugins. |

## Notes

- Very large libraries (e.g. Enamine REAL) are streamed and **capped at 300k
  rows** in the browser (a banner shows when truncated). The full set is a job
  for the native build.
- Structure depictions are theme-aware and copy as transparent vector/PNG for
  pasting into slides.
