import { useState } from 'react';
import { Editor } from 'ketcher-react';
import { StandaloneStructServiceProvider } from 'ketcher-standalone';
import type { Ketcher } from 'ketcher-core';
import 'ketcher-react/dist/index.css';
import { useStore } from '../data/store';
import { substructureSearch } from '../chem/substructure';

// Created once; instantiates the Indigo WASM worker on first use (browser only).
const structServiceProvider = new StandaloneStructServiceProvider();

/**
 * ChemDraw/Marvin-like structure sketcher (EPAM Ketcher). The drawn structure
 * can be pushed to the Browse page as a substructure (SMARTS) filter.
 */
export default function SketchPage() {
  const [ketcher, setKetcher] = useState<Ketcher | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const library = useStore((s) => s.library);
  const setSubstructure = useStore((s) => s.setSubstructure);
  const setPage = useStore((s) => s.setPage);

  const useAsFilter = async () => {
    if (!ketcher) return;
    if (!library) {
      setStatus('Load a library in Browse first.');
      return;
    }
    setStatus('Searching…');
    let query = '';
    try {
      query = (await ketcher.getSmarts()) || (await ketcher.getSmiles());
    } catch {
      query = await ketcher.getSmiles().catch(() => '');
    }
    if (!query.trim()) {
      setStatus('Draw a structure first.');
      return;
    }
    const result = await substructureSearch(
      query,
      library.compounds.map((c) => c.smiles),
    );
    if (result.invalidQuery) {
      setStatus('Query could not be interpreted as a substructure.');
      return;
    }
    setSubstructure(query, new Set(result.matches));
    setPage('browse');
  };

  return (
    <div className="page-simple sketch">
      <div className="sketch-bar">
        <h2>Sketch</h2>
        <span className="muted">Draw a structure, then search the library.</span>
        <span className="spacer" />
        {status && <span className="muted">{status}</span>}
        <button className="primary" onClick={useAsFilter} disabled={!ketcher}>
          Use as substructure filter →
        </button>
      </div>

      {error && <div className="error-inline">Sketcher error: {error}</div>}

      <div className="ketcher-host">
        <Editor
          staticResourcesUrl=""
          structServiceProvider={structServiceProvider}
          errorHandler={(m) => setError(String(m))}
          onInit={(k: Ketcher) => setKetcher(k)}
        />
      </div>
    </div>
  );
}
