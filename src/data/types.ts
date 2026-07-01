/** Core data model for ChemViewer. */

export type ColumnKind = 'number' | 'text' | 'url' | 'structure';

export interface ColumnDef {
  /** Stable key used to look up values in `Compound.props`. */
  key: string;
  /** Human-readable header. */
  label: string;
  kind: ColumnKind;
}

export interface Compound {
  /** Original 0-based position in the source file. */
  index: number;
  /** Unique id within the library (Catalog ID when available, else row index). */
  id: string;
  /** Canonical structure source. */
  smiles: string;
  /** All columns by key, including numeric props and text fields. */
  props: Record<string, number | string>;
}

export type SourceFormat = 'csv' | 'sdf' | 'smiles';

export interface Library {
  id: string;
  name: string;
  sourceFormat: SourceFormat;
  /** Display columns (excludes the implicit structure column). */
  columns: ColumnDef[];
  /** In-memory rows (empty for DuckDB-backed libraries, which page from disk). */
  compounds: Compound[];
  /** 'duckdb' libraries query on disk; 'memory' hold compounds in the renderer. */
  backend: 'memory' | 'duckdb';
  /** Total row count (for db-backed libraries). */
  total?: number;
  /** Column keys for the db-backed query layer. */
  smilesKey?: string | null;
  idKey?: string | null;
  /** Contents of a README found alongside the data, if any. */
  readme?: string;
  /** True if the source was larger than the row cap and was truncated. */
  truncated?: boolean;
}

// ---- Filter rules -----------------------------------------------------------

export interface NumberRangeRule {
  type: 'number-range';
  /** Column key to filter on. */
  column: string;
  min?: number;
  max?: number;
}

export interface TextContainsRule {
  type: 'text-contains';
  /** Column key, or 'id'/'smiles' for the built-in fields. */
  column: string;
  query: string;
}

export interface SubstructureRule {
  type: 'substructure';
  smarts: string;
}

/** Categorical "is" filter: value must be one of the selected values. */
export interface ValueInRule {
  type: 'value-in';
  column: string;
  values: string[];
}

export type FilterRule =
  | NumberRangeRule
  | TextContainsRule
  | SubstructureRule
  | ValueInRule;

/** A named, saved selection of compounds (by id). */
export interface Subset {
  id: string;
  name: string;
  libraryId: string;
  /** Selected compound ids that make up the subset. */
  memberIds: string[];
  createdAt: number;
}
