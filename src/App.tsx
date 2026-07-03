import { Suspense, lazy, useEffect } from 'react';
import { useStore } from './data/store';
import { AppNav } from './components/AppNav';
import { BrowsePage } from './components/BrowsePage';
import { AnalysePage } from './components/AnalysePage';
import { MoleculeDialog } from './components/MoleculeDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { PrecomputeManager } from './components/PrecomputeManager';
import { applyAccent } from './theme/accent';

// Ketcher is heavy and pulls in a WASM worker — load it only when needed.
const SketchPage = lazy(() => import('./components/SketchPage'));

export function App() {
  const page = useStore((s) => s.page);
  const library = useStore((s) => s.library);
  const selectedCompound = useStore((s) => s.selectedCompound);
  const selectCompound = useStore((s) => s.selectCompound);
  const error = useStore((s) => s.loadError);
  const theme = useStore((s) => s.theme);
  const accent = useStore((s) => s.accent);
  const setResolvedTheme = useStore((s) => s.setResolvedTheme);
  const loadSubsets = useStore((s) => s.loadSubsets);
  const initFromManifest = useStore((s) => s.initFromManifest);
  const loadComparisons = useStore((s) => s.loadComparisons);

  useEffect(() => {
    loadSubsets();
    initFromManifest();
    loadComparisons();
  }, [loadSubsets, initFromManifest, loadComparisons]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved =
        theme === 'auto' ? (mq.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      setResolvedTheme(resolved);
    };
    apply();
    if (theme === 'auto') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme, setResolvedTheme]);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  return (
    <div className="app">
      <AppNav />
      {error && <div className="error">{error}</div>}
      {library?.truncated && (
        <div className="notice">
          This library is larger than the browser limit — showing the first{' '}
          {library.compounds.length.toLocaleString()} compounds. Use the desktop
          build for the full set.
        </div>
      )}

      {page === 'browse' && <BrowsePage />}
      {page === 'analyse' && <AnalysePage />}
      {page === 'sketch' && (
        <Suspense fallback={<div className="empty">Loading sketcher…</div>}>
          <SketchPage />
        </Suspense>
      )}

      {selectedCompound && library && (
        <MoleculeDialog
          compound={selectedCompound}
          columns={library.columns}
          onClose={() => selectCompound(null)}
        />
      )}

      <SettingsDialog />

      <PrecomputeManager />
    </div>
  );
}
