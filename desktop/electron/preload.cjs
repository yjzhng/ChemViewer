// Preload: the typed bridge between the renderer and the main process.
// Exposed as window.chemviewer (contextIsolation-safe).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('chemviewer', {
  isDesktop: true,
  // Open a native file dialog to pick library files. Returns { paths, names } or
  // { canceled: true }. No files are moved/copied yet — the renderer's import
  // dialog collects a name + copy/move choice, then calls importLibraryFiles.
  pickLibraryFiles: () => ipcRenderer.invoke('pick-library-files'),
  // Copy/move the previously-picked files into a new library folder under the
  // app's library/ root. Returns { name, count } or { error }.
  importLibraryFiles: (opts) => ipcRenderer.invoke('import-library-files', opts),
  // Permanently delete a library folder from the app's library/ root.
  // Returns { ok: true } or { error }.
  deleteLibrary: (name) => ipcRenderer.invoke('delete-library', name),
})
