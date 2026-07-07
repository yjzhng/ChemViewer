# ChemViewer

Interactive browser for chemical libraries: explore compound properties,
view property statistics, and compare libraries.

## Quick start

Launch **ChemViewer.app** in the repo. First launch installs
dependencies (may take a few minutes)

To load a library, drop libray files in folder named after the library under `library/` 

Currently supported formats: `.csv`, `.sdf`,
`.smiles`, or `.cxsmiles`

## Advanced (command line)

```sh
make install        # or: npm install
make desktop        # native window around the live Vite server
npm run dev         # browser-only dev server (http://localhost:5173)
```

See [desktop/README.md](desktop/README.md) for the port guard and env toggles.

## Notes

- Small library are loaded in memory(<50 MB).  Large CSV/SMILES files (over 50 MB) are queried on disk via DuckDB
- Table will be **capped at 300k rows** (with banner notification)
- SDF is always memory-backed, so only use SDF format for small libraries
- As the tool is intended to be light-weight, locally run, large libraries are subsampled before any analysis
- Options to compute full library stats are available

## References

- [RDKit](https://www.rdkit.org/) ([@rdkit/rdkit](https://www.npmjs.com/package/@rdkit/rdkit)) — WASM 2D depiction, descriptors, fingerprints, substructure search.
- [Ketcher](https://github.com/epam/ketcher) — in-app structure sketcher.
- [OpenChemLib](https://github.com/cheminfo/openchemlib-js) — conformer / PMI descriptors.
- [DuckDB](https://duckdb.org/) — on-disk querying of large libraries.
- [TanStack Table](https://tanstack.com/table) / [Virtual](https://tanstack.com/virtual) — virtualized data grid.
- [umap-js](https://github.com/PAIR-code/umap-js) — dimensionality reduction for embedding plots.
- [Vite](https://vitejs.dev/) · [React](https://react.dev/) · [Electron](https://www.electronjs.org/) — build tooling and desktop shell.
