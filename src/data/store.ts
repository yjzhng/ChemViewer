/** Global app state (zustand). */
import { create } from 'zustand';
import type {
  Compound,
  FilterRule,
  Library,
  NumberRangeRule,
  Subset,
  TextContainsRule,
} from './types';
import {
  deleteSubset as dbDeleteSubset,
  getAllSubsets,
  putSubset,
} from './persistence';
import {
  fetchManifest,
  loadLibraryFromManifest,
  type ManifestEntry,
} from './loaders/manifest';
import {
  computeComparison,
  comparisonSig,
  loadComparisons as loadComparisonsDb,
  persistComparisons,
  persistResult,
  deleteResult,
  samplingCount,
  DB_ALL_CAP,
  type Comparison,
  type CmpSource,
  type CmpStatus,
} from './comparisons';
import { materializeSubset } from './sources';
import { dbSample } from './dbClient';
import { sampleIndices } from '../stats/sample';
import type { DrawOptions } from '../chem/render';

export interface SubstructureState {
  smarts: string;
  matches: Set<number>;
}

/** Top-level pages reachable from the main nav. */
export type AppPage = 'browse' | 'analyse' | 'sketch';

/** Sub-view of the Library page: the data browser, or the folder manager. */
export type LibraryView = 'browse' | 'manage';

/** Precompute lifecycle of a library (drives the manager + selector gating). */
export type LibState =
  | 'queued'
  | 'loading'
  | 'precomputing'
  | 'ready'
  | 'error';
export interface LibStatus {
  state: LibState;
  /** Similarity-map precompute progress, 0..1. */
  sim: number;
  /** PMI precompute progress, 0..1. */
  pmi: number;
}

export type Theme = 'auto' | 'dark' | 'light';

const THEME_KEY = 'chemviewer-theme';
const ACCENT_KEY = 'chemviewer-accent';
const DRAW_KEY = 'chemviewer-draw';
const SCALE_KEY = 'chemviewer-structscale';

function initialAccent(): string | null {
  try {
    return localStorage.getItem(ACCENT_KEY) || null;
  } catch {
    return null;
  }
}

function initialScale(): number {
  try {
    const v = Number(localStorage.getItem(SCALE_KEY));
    return v >= 40 && v <= 100 ? v : 100;
  } catch {
    return 100;
  }
}

function initialTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'dark' || v === 'light' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'auto') return theme;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  } catch {
    return 'dark';
  }
}

function initialDraw(): DrawOptions {
  try {
    const v = localStorage.getItem(DRAW_KEY);
    return v ? (JSON.parse(v) as DrawOptions) : {};
  } catch {
    return {};
  }
}

interface AppState {
  /** Active top-level page. */
  page: AppPage;
  /** Color theme (auto follows the OS preference). */
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** The concrete theme after resolving "auto"; drives molecule colors. */
  resolvedTheme: 'dark' | 'light';
  setResolvedTheme: (t: 'dark' | 'light') => void;
  /** Custom accent color (hex), or null for the theme default. */
  accent: string | null;
  setAccent: (hex: string | null) => void;
  /** Molecule drawing options (Settings → Chemical display). */
  draw: DrawOptions;
  setDraw: (partial: Partial<DrawOptions>) => void;
  /** Settings dialog visibility. */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  library: Library | null;
  /** Library page sub-view: browse the data or manage the folder. */
  libraryView: LibraryView;
  setLibraryView: (v: LibraryView) => void;
  /** Per-library precompute status (keyed by name) — drives manager + gating. */
  libStatus: Record<string, LibStatus>;
  setLibStatus: (name: string, patch: Partial<LibStatus>) => void;
  /** Cache a parsed library without switching to it (used by precompute). */
  cacheLibrary: (library: Library) => void;
  /** Libraries discovered by the auto-scan of the on-disk library/ folder. */
  manifest: ManifestEntry[];
  /** Folder-loaded libraries kept in memory so the dropdown can switch back. */
  extras: Record<string, Library>;
  /** All loaded libraries by name — avoids re-parsing when switching back. */
  cache: Record<string, Library>;
  /** Label for the currently-scanned directory (shown in the main nav). */
  directoryLabel: string;
  /** True while a library is being fetched/parsed. */
  libraryLoading: boolean;
  loadError: string | null;
  /** Persisted filter rules (numeric ranges + per-column text + substructure). */
  rules: FilterRule[];
  /** Free-text search across id + SMILES (not persisted as a rule). */
  globalSearch: string;
  /** Computed substructure matches for the active substructure rule. */
  substructure: SubstructureState | null;
  showStructures: boolean;
  /** Structure depiction scale as a percentage (40–100); lower = more compact. */
  structureScale: number;
  setStructureScale: (pct: number) => void;
  /** Multi-select mode reveals a checkbox column in the table. */
  multiselect: boolean;
  toggleMultiselect: () => void;
  /** Ids of selected compounds. */
  selected: Set<string>;
  toggleRowSelected: (id: string) => void;
  setManySelected: (ids: string[], on: boolean) => void;
  clearSelection: () => void;
  selectedCompound: Compound | null;
  /** Row currently hovered in the table (drives stat histogram highlights). */
  hoveredCompound: Compound | null;
  setHoveredCompound: (c: Compound | null) => void;
  subsets: Subset[];
  /** Currently-applied saved subset, or null for "Full"/custom. */
  activeSubsetId: string | null;

  /** Saved Analyse comparison jobs (persisted config + status). */
  comparisons: Comparison[];
  /** Live compute progress (0..1) for running comparisons, keyed by id. */
  comparisonProgress: Record<string, number>;
  loadComparisons: () => Promise<void>;
  /** Insert or update a comparison and persist the list. */
  saveComparison: (cmp: Comparison) => Promise<void>;
  removeComparison: (id: string) => Promise<void>;
  /** Run a comparison in the worker, persisting its result when ready. */
  runComparison: (cmp: Comparison) => Promise<void>;

  setPage: (page: AppPage) => void;
  setLibrary: (library: Library) => void;
  /** Scan the bundled library/ folder and auto-load the first source. */
  initFromManifest: () => Promise<void>;
  /** Load a specific discovered library by manifest entry. */
  loadManifestEntry: (entry: ManifestEntry) => Promise<void>;
  /** Switch the active library by name (scanned entry or folder-loaded extra). */
  selectLibraryByName: (name: string) => Promise<void>;
  /** Register a folder-loaded library and make it active. */
  addExtraLibrary: (library: Library, directoryLabel: string) => void;
  /** Names of all selectable libraries (scanned + folder-loaded). */
  libraryNames: () => string[];
  setLoadError: (message: string | null) => void;
  setGlobalSearch: (q: string) => void;
  toggleStructures: () => void;
  selectCompound: (c: Compound | null) => void;

  setNumberRange: (column: string, min?: number, max?: number) => void;
  setTextContains: (column: string, query: string) => void;
  setValueIn: (column: string, values: string[]) => void;
  setSubstructure: (smarts: string, matches: Set<number>) => void;
  /** Update only the substructure match set (used when re-running a subset). */
  setSubstructureResult: (smarts: string, matches: Set<number>) => void;
  clearSubstructure: () => void;
  clearFilters: () => void;

  loadSubsets: () => Promise<void>;
  saveSubset: (name: string) => Promise<void>;
  applySubset: (subset: Subset) => void;
  /** Reset to the full library (the default "Full" subset). */
  selectFull: () => void;
  deleteSubset: (id: string) => Promise<void>;
  /** Display name of the active subset: a saved name, "Full", or "Custom". */
  activeSubsetName: () => string;
}

function upsertRule(
  rules: FilterRule[],
  next: FilterRule,
  match: (r: FilterRule) => boolean,
  keep: boolean,
): FilterRule[] {
  const without = rules.filter((r) => !match(r));
  return keep ? [...without, next] : without;
}

export const useStore = create<AppState>((set, get) => ({
  page: 'browse',
  theme: initialTheme(),
  resolvedTheme: resolveTheme(initialTheme()),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
  accent: initialAccent(),
  setAccent: (accent) => {
    try {
      if (accent) localStorage.setItem(ACCENT_KEY, accent);
      else localStorage.removeItem(ACCENT_KEY);
    } catch {
      /* ignore */
    }
    set({ accent });
  },
  draw: initialDraw(),
  setDraw: (partial) =>
    set((s) => {
      const draw = { ...s.draw, ...partial };
      try {
        localStorage.setItem(DRAW_KEY, JSON.stringify(draw));
      } catch {
        /* ignore */
      }
      return { draw };
    }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  library: null,
  libraryView: 'manage',
  setLibraryView: (libraryView) => set({ libraryView }),
  libStatus: {},
  setLibStatus: (name, patch) =>
    set((s) => {
      const prev = s.libStatus[name] ?? {
        state: 'queued' as LibState,
        sim: 0,
        pmi: 0,
      };
      return {
        libStatus: { ...s.libStatus, [name]: { ...prev, ...patch } },
      };
    }),
  cacheLibrary: (library) =>
    set((s) => ({ cache: { ...s.cache, [library.name]: library } })),
  manifest: [],
  extras: {},
  cache: {},
  directoryLabel: 'library/',
  libraryLoading: false,
  loadError: null,
  rules: [],
  globalSearch: '',
  substructure: null,
  showStructures: true,
  structureScale: initialScale(),
  multiselect: false,
  selected: new Set<string>(),
  selectedCompound: null,
  hoveredCompound: null,
  setHoveredCompound: (hoveredCompound) => set({ hoveredCompound }),
  subsets: [],
  activeSubsetId: null,
  comparisons: [],
  comparisonProgress: {},

  loadComparisons: async () => {
    set({ comparisons: await loadComparisonsDb() });
  },

  saveComparison: async (cmp) => {
    set((s) => {
      const exists = s.comparisons.some((c) => c.id === cmp.id);
      return {
        comparisons: exists
          ? s.comparisons.map((c) => (c.id === cmp.id ? cmp : c))
          : [...s.comparisons, cmp],
      };
    });
    await persistComparisons(get().comparisons);
  },

  removeComparison: async (id) => {
    set((s) => ({ comparisons: s.comparisons.filter((c) => c.id !== id) }));
    await persistComparisons(get().comparisons);
    await deleteResult(id);
  },

  runComparison: async (cmp) => {
    const running: Comparison = { ...cmp, status: 'running' as CmpStatus };
    await get().saveComparison(running);
    set((s) => ({ comparisonProgress: { ...s.comparisonProgress, [cmp.id]: 0 } }));

    // Resolve one source to its sampled compounds (parsing memory libs on
    // demand; DuckDB libs are sampled on disk).
    const sampleSource = async (src: CmpSource) => {
      const st = get();
      const n = samplingCount(src.sampling, src.backend);
      if (src.kind === 'library' && src.backend === 'duckdb') {
        return dbSample(
          src.libName,
          { rules: [], globalSearch: '' },
          Number.isFinite(n) ? (n as number) : DB_ALL_CAP,
        );
      }
      let lib = st.cache[src.libName] ?? st.extras[src.libName] ?? null;
      if (!lib) {
        const entry = st.manifest.find((m) => m.name === src.libName);
        if (!entry) return [];
        lib = await loadLibraryFromManifest(entry);
        get().cacheLibrary(lib);
      }
      let pool = lib.compounds;
      if (src.kind === 'subset') {
        const sub = st.subsets.find((x) => x.id === src.subsetId);
        pool = sub ? materializeSubset(sub, lib) : [];
      }
      if (!Number.isFinite(n)) return pool;
      return sampleIndices(pool.length, n as number).map((i) => pool[i]);
    };

    try {
      const result = await computeComparison(running, sampleSource, (frac) =>
        set((s) => ({
          comparisonProgress: { ...s.comparisonProgress, [cmp.id]: frac },
        })),
      );
      await persistResult(cmp.id, result);
      await get().saveComparison({
        ...running,
        status: 'ready',
        error: undefined,
        computedSig: comparisonSig(running),
      });
    } catch (e) {
      const error = String((e as Error)?.message ?? e);
      console.error('[comparison] compute failed:', e);
      await get().saveComparison({ ...running, status: 'error', error });
    } finally {
      set((s) => {
        const p = { ...s.comparisonProgress };
        delete p[cmp.id];
        return { comparisonProgress: p };
      });
    }
  },

  setPage: (page) => set({ page }),

  setLibrary: (library) =>
    set((s) => ({
      library,
      cache: { ...s.cache, [library.name]: library },
      rules: [],
      globalSearch: '',
      substructure: null,
      selectedCompound: null,
      activeSubsetId: null,
    })),

  initFromManifest: async () => {
    // Only scan for the manifest here — don't parse any library. Parsing a
    // source file (tens of thousands of rows) is the slow part of "opening" a
    // library, and it's independent of the precompute cache. Libraries are now
    // parsed on demand when the user opens one from the Manage view, so launch
    // stays instant even when everything is already precomputed.
    set({ libraryLoading: true, loadError: null });
    try {
      const manifest = await fetchManifest();
      set({ manifest });
    } catch (err) {
      set({ loadError: String((err as Error)?.message ?? err) });
    } finally {
      set({ libraryLoading: false });
    }
  },

  loadManifestEntry: async (entry) => {
    // Reuse the already-parsed library if we've loaded it this session.
    const cached = get().cache[entry.name];
    if (cached) {
      get().setLibrary(cached);
      return;
    }
    set({ libraryLoading: true, loadError: null });
    try {
      get().setLibrary(await loadLibraryFromManifest(entry));
    } catch (err) {
      set({ loadError: String((err as Error)?.message ?? err) });
    } finally {
      set({ libraryLoading: false });
    }
  },

  selectLibraryByName: async (name) => {
    const cached = get().cache[name] ?? get().extras[name];
    if (cached) {
      get().setLibrary(cached);
      return;
    }
    const entry = get().manifest.find((m) => m.name === name);
    if (entry) await get().loadManifestEntry(entry);
  },

  addExtraLibrary: (library, directoryLabel) => {
    set((s) => ({
      extras: { ...s.extras, [library.name]: library },
      directoryLabel,
    }));
    get().setLibrary(library);
  },

  libraryNames: () => {
    const { manifest, extras } = get();
    const names = manifest.map((m) => m.name);
    for (const n of Object.keys(extras)) {
      if (!names.includes(n)) names.push(n);
    }
    return names;
  },

  setLoadError: (message) => set({ loadError: message }),

  setGlobalSearch: (q) => set({ globalSearch: q }),
  toggleStructures: () => set((s) => ({ showStructures: !s.showStructures })),
  setStructureScale: (pct) => {
    const clamped = Math.max(40, Math.min(100, Math.round(pct)));
    try {
      localStorage.setItem(SCALE_KEY, String(clamped));
    } catch {
      /* ignore */
    }
    set({ structureScale: clamped });
  },

  toggleMultiselect: () =>
    set((s) => ({
      multiselect: !s.multiselect,
      // Clear the selection when leaving multi-select mode.
      selected: s.multiselect ? new Set<string>() : s.selected,
    })),

  toggleRowSelected: (id) =>
    set((s) => {
      const selected = new Set(s.selected);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { selected };
    }),

  setManySelected: (ids, on) =>
    set((s) => {
      const selected = new Set(s.selected);
      for (const id of ids) {
        if (on) selected.add(id);
        else selected.delete(id);
      }
      return { selected };
    }),

  clearSelection: () => set({ selected: new Set<string>() }),
  selectCompound: (c) => set({ selectedCompound: c }),

  setNumberRange: (column, min, max) =>
    set((s) => {
      const next: NumberRangeRule = { type: 'number-range', column, min, max };
      const empty = min === undefined && max === undefined;
      return {
        rules: upsertRule(
          s.rules,
          next,
          (r) => r.type === 'number-range' && r.column === column,
          !empty,
        ),
      };
    }),

  setTextContains: (column, query) =>
    set((s) => {
      const next: TextContainsRule = { type: 'text-contains', column, query };
      return {
        rules: upsertRule(
          s.rules,
          next,
          (r) => r.type === 'text-contains' && r.column === column,
          query.trim() !== '',
        ),
      };
    }),

  setValueIn: (column, values) =>
    set((s) => ({
      rules: upsertRule(
        s.rules,
        { type: 'value-in', column, values },
        (r) => r.type === 'value-in' && r.column === column,
        values.length > 0,
      ),
    })),

  setSubstructure: (smarts, matches) =>
    set((s) => ({
      substructure: { smarts, matches },
      rules: upsertRule(
        s.rules,
        { type: 'substructure', smarts },
        (r) => r.type === 'substructure',
        smarts.trim() !== '',
      ),
    })),

  setSubstructureResult: (smarts, matches) =>
    set({ substructure: { smarts, matches } }),

  clearSubstructure: () =>
    set((s) => ({
      substructure: null,
      rules: s.rules.filter((r) => r.type !== 'substructure'),
    })),

  clearFilters: () => set({ rules: [], globalSearch: '', substructure: null }),

  loadSubsets: async () => {
    set({ subsets: await getAllSubsets() });
  },

  // Save the current multi-select as a named subset, then make it active.
  saveSubset: async (name) => {
    const { library, selected } = get();
    if (!library || selected.size === 0) return;
    const subset: Subset = {
      id: crypto.randomUUID(),
      name,
      libraryId: library.id,
      memberIds: [...selected],
      createdAt: Date.now(),
    };
    await putSubset(subset);
    // Saving exits multi-select and clears the selection.
    set((s) => ({
      subsets: [...s.subsets, subset],
      activeSubsetId: subset.id,
      multiselect: false,
      selected: new Set<string>(),
    }));
  },

  // Subsets restrict the visible compounds. Switching subset resets the current
  // selection and filter state.
  applySubset: (subset) =>
    set({
      activeSubsetId: subset.id,
      selected: new Set<string>(),
      rules: [],
      globalSearch: '',
      substructure: null,
    }),

  selectFull: () =>
    set({
      activeSubsetId: null,
      selected: new Set<string>(),
      rules: [],
      globalSearch: '',
      substructure: null,
    }),

  deleteSubset: async (id) => {
    await dbDeleteSubset(id);
    set((s) => ({
      subsets: s.subsets.filter((x) => x.id !== id),
      activeSubsetId: s.activeSubsetId === id ? null : s.activeSubsetId,
    }));
  },

  activeSubsetName: () => {
    const { activeSubsetId, subsets } = get();
    return subsets.find((s) => s.id === activeSubsetId)?.name ?? 'Full';
  },
}));
