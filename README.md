# ChemViewer

Interactive browser for chemical libraries — explore compound properties, view
property statistics, and compare libraries. Runs as a macOS desktop app or from
source in the browser.

Features:

- Auto-scans a library folder; loads `.csv`, `.sdf`, `.smiles`, `.cxsmiles`
- Fast virtualized table with live-rendered structures ([RDKit](https://www.rdkit.org))
- Compound property statistics and library-vs-library comparison
- Large libraries queried on disk via [DuckDB](https://duckdb.org) — no full load

## Quick start — install the app (macOS)

1. Download the `.dmg` from the [latest release](https://github.com/yjzhng/ChemViewer/releases/latest) — `arm64` (Apple Silicon).
2. Open it and drag **ChemViewer** to Applications.
3. **First launch** may be blocked by system security:
   - **macOS 15 (Sequoia) or newer:** double-click ChemViewer → a "not opened"
     alert appears → open **System Settings → Privacy & Security**, scroll down,
     and click **Open Anyway**.
   - **macOS 14 or older:** **right-click** ChemViewer → **Open** → **Open** in
     the dialog.
4. After that it opens normally.

> [!TIP]
> Terminal alternative to the Gatekeeper prompt, once installed:
> `xattr -dr com.apple.quarantine /Applications/ChemViewer.app`

### Add your libraries

Drop a folder (named after the library) holding a `.csv`, `.sdf`, `.smiles`, or
`.cxsmiles` file into `~/Library/Application Support/ChemViewer/library/` — it's
auto-discovered on next launch. The app ships with an example drug library.

## Run from source (developers)

Needs [Node.js](https://nodejs.org) + git.

- **Native window (macOS):** clone the repo and double-click `ChemViewer.app`
  (first run installs deps), or `make desktop`. Add libraries in the repo's
  `library/` folder. See [desktop/README.md](desktop/README.md).
- **Browser / any OS:** `npm install && npm run dev` → http://localhost:5173

### Build the installer

```sh
npm --prefix desktop install     # one-time: Electron + electron-builder
npm --prefix desktop run dist    # → desktop/release/ChemViewer-<version>-arm64.dmg
```

Ad-hoc signed (no Apple Developer ID), which is why a downloaded copy shows the
"unidentified developer / Open Anyway" dialog. See
[desktop/README.md](desktop/README.md) for the packaged-app architecture.

## Notes

- Large CSV/SMILES (>50 MB) are queried on disk via DuckDB and load in full;
  everything else is held in memory and **capped at 300k rows** (a banner shows
  when truncated) — this can hit a dense sub-50 MB file or any SDF (SDF is always
  memory-backed).
- Large libraries are subsampled before analysis (kept light-weight and local);
  full-library stats are available on demand.
- Structure depictions are theme-aware and copy as transparent vector/PNG.

## Built with

- [RDKit](https://www.rdkit.org/) — 2D depiction, descriptors, fingerprints, substructure search.
- [Ketcher](https://github.com/epam/ketcher) — in-app structure sketcher.
- [OpenChemLib](https://github.com/cheminfo/openchemlib-js) — conformer / PMI descriptors.
- [DuckDB](https://duckdb.org/) — on-disk querying of large libraries.
- [TanStack Table](https://tanstack.com/table) / [Virtual](https://tanstack.com/virtual) — virtualized data grid.
- [umap-js](https://github.com/PAIR-code/umap-js) — dimensionality reduction for embedding plots.
- [React](https://react.dev/) · [Vite](https://vitejs.dev/) · [Electron](https://www.electronjs.org/) + [electron-builder](https://www.electron.build) — UI, build, desktop shell & packaging.
