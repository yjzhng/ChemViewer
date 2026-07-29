// electron-builder config for the packaged ChemViewer DMG.
//
// asar is DISABLED on purpose: the app bundles a native N-API module
// (@duckdb/node-api → @duckdb/node-bindings-darwin-arm64/duckdb.node) and loads
// an ESM backend (electron/duckdb.mjs) via dynamic import. Keeping everything as
// plain files sidesteps asar's native-module unpacking and ESM-in-asar quirks.
//
// Renderer, the DuckDB backend, and the seed library are copied into desktop/ by
// scripts/build-dmg.mjs before this runs (see that script).

module.exports = {
  appId: 'tech.yjzhng.chemviewer',
  productName: 'ChemViewer',
  asar: false,
  directories: {
    output: 'release',
    buildResources: 'build-resources'
  },
  // App payload. electron-builder always adds production node_modules
  // (@duckdb/*) on top of these and always drops devDependencies (electron,
  // electron-builder).
  files: [
    'electron/**',
    'renderer/**',
    'library-seed/**',
    'package.json',
    '!**/*.map'
  ],
  extraMetadata: {
    main: 'electron/main.cjs'
  },
  // Ad-hoc sign the bundle after packing (see scripts/afterPack.cjs) — arm64
  // apps need a valid signature to launch, and electron-builder's own signing is
  // skipped below via identity: null.
  afterPack: './scripts/afterPack.cjs',
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    icon: 'build-resources/icon.icns',
    category: 'public.app-category.education',
    // No Developer ID cert in this environment → ad-hoc sign (identity: null).
    // arm64 apps must be signed to launch at all; ad-hoc satisfies that, though
    // users still see Gatekeeper's "unidentified developer" prompt on first open.
    identity: null
  },
  dmg: {
    title: 'ChemViewer ${version}'
  }
}
