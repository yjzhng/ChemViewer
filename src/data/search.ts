/**
 * Types + factory for the Search page's saved query tiles. Queries live in the
 * store (in memory) so they survive navigating away from the page; results are
 * kept inline on each query, mirroring how Analyse comparisons carry results.
 */
import type { Compound } from './types';

export type SearchType = 'substructure' | 'similarity';

export interface SearchMatch {
  compound: Compound;
  /** Tanimoto similarity to the query (similarity searches only). */
  score?: number;
}

export interface SearchResults {
  type: SearchType;
  sourceLabel: string;
  libName: string;
  /** True when the searched pool is a whole library (indices map 1:1). */
  isFullLib: boolean;
  query: string;
  threshold?: number;
  /** Total matches found (before the display cap). */
  count: number;
  /** Capped list rendered as cards. */
  matches: SearchMatch[];
  /** Match indices into the library's compounds (full-library searches). */
  libIndices?: number[];
}

export interface SearchQuery {
  id: string;
  name: string;
  smiles: string;
  searchType: SearchType;
  threshold: number;
  maxResults: number;
  /** Selected source id ('' = fall back to the default/active library). */
  target: string;
  results: SearchResults | null;
  running: boolean;
}

export function blankQuery(name: string): SearchQuery {
  return {
    id: crypto.randomUUID(),
    name,
    smiles: '',
    searchType: 'substructure',
    threshold: 0.7,
    maxResults: 500,
    target: '',
    results: null,
    running: false,
  };
}
