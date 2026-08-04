/// <reference types="vite/client" />

// App version, injected by Vite `define` (see vite.config.ts) from desktop/package.json.
declare const __APP_VERSION__: string;

// Desktop bridge exposed by desktop/electron/preload.cjs (undefined in a browser).
interface ChemViewerPickResult {
  paths?: string[];
  names?: string[];
  canceled?: boolean;
}
interface ChemViewerImportResult {
  name?: string;
  count?: number;
  error?: string;
}
interface Window {
  chemviewer?: {
    isDesktop?: boolean;
    pickLibraryFiles?: () => Promise<ChemViewerPickResult>;
    importLibraryFiles?: (opts: {
      name: string;
      mode: 'copy' | 'move';
      paths: string[];
    }) => Promise<ChemViewerImportResult>;
    deleteLibrary?: (name: string) => Promise<{ ok?: boolean; error?: string }>;
  };
}
