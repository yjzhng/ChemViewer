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
 * Marvin/ChemDraw-like structure sketcher (EPAM Ketcher). The drawn structure
 * can be copied as SMILES or pushed to the Library page as a substructure filter.
 */
export default function SketchPage() {
  const [ketcher, setKetcher] = useState<Ketcher | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const library = useStore((s) => s.library);
  const setSubstructure = useStore((s) => s.setSubstructure);
  const setPage = useStore((s) => s.setPage);

  const copySmiles = async () => {
    if (!ketcher) return;
    const smiles = (await ketcher.getSmiles().catch(() => '')).trim();
    if (!smiles) {
      setStatus('Draw a structure first.');
      return;
    }
    try {
      await navigator.clipboard.writeText(smiles);
      setStatus(`Copied: ${smiles}`);
    } catch {
      setStatus(smiles);
    }
  };

  const useAsFilter = async () => {
    if (!ketcher) return;
    if (!library) {
      setStatus('Open a library (Library page) first.');
      return;
    }
    if (library.backend === 'duckdb') {
      setStatus('Substructure filtering isn’t available for on-disk (DuckDB) libraries.');
      return;
    }
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
    setStatus('Searching…');
    const result = await substructureSearch(
      query,
      library.compounds.map((c) => c.smiles),
    );
    if (result.invalidQuery) {
      setStatus('Could not interpret the drawing as a substructure.');
      return;
    }
    setSubstructure(query, new Set(result.matches));
    setPage('browse');
  };

  return (
    <div className="page-simple sketch">
      <div className="sketch-bar">
        <h2>Sketch</h2>
        <span className="muted">Draw a structure.</span>
        <span className="spacer" />
        {status && <span className="muted sketch-status">{status}</span>}
        <button onClick={copySmiles} disabled={!ketcher}>
          Copy SMILES
        </button>
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
