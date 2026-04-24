/**
 * ProtVista runtime registry.
 *
 * The registry is the single source of truth for every name referenced
 * from a config: semantic kinds, adapters, and colour-scale themes.
 * It is consumed by:
 *
 *   - the runtime validator to close the open-string unions
 *     declared in `types.ts` / `schema.json` ("Unknown adapter: <name>.
 *     Did you forget to call registerAdapter()?");
 *   - the loader to resolve semantic kinds into concrete
 *     (component, adapter, rendering) tuples at mount time;
 *   - the escape-hatch runtime API (`registerAdapter`,
 *     `registerSemanticKind`, `registerTheme`) exposed on
 *     `<protvista-uniprot>` per `ProtvistaRuntimeAPI`.
 *
 * Design notes:
 *
 *   - Built-ins are seeded at construction, not through the public
 *     `register*` methods. User code attempting to register over a
 *     built-in (or a previously-registered custom name) throws — the
 *     spec's escape-hatch docstrings say "must not collide with
 *     built-ins" and silent overrides would make the viewer's
 *     behaviour depend on call order.
 *   - Adapter *function bodies* are intentionally not seeded here —
 *     adapters are registered by the loader when it boots. This keeps
 *     this file dependency-free and trivially unit-testable.
 *   - The 12 built-in semantic kinds reference adapter names that are
 *     not yet registered. That is fine: `resolveSemanticKind()` returns
 *     the adapter *name* (a string), and the loader looks up the
 *     adapter function in the registry at fetch time — by then the
 *     loader has also called `registerBuiltinAdapters()`.
 *   - `createRegistry()` is a factory (not a module-level singleton)
 *     so tests and downstream embedders can instantiate isolated
 *     registries. The `<protvista-uniprot>` element will hold one
 *     per instance.
 *
 * A transforms bucket (register/get/has/listTransforms +
 * BUILTIN_TRANSFORM_OPERATORS) will be added here when the planned
 * Vega-Lite-style transform engine is implemented — see
 * `specs/transform-engine.md`.
 */

import type {
  SemanticKindDefinition,
  AdapterFunction,
  ColorStop,
  KnownSemanticKind,
  KnownComponentName,
  KnownAdapterName,
} from './types';

// ─────────────────────────────────────────────────────────────
// Public Registry interface
// ─────────────────────────────────────────────────────────────

export interface Registry {
  // ── Semantic kinds ────────────────────────────────────────
  registerSemanticKind(name: string, def: SemanticKindDefinition): void;
  getSemanticKind(name: string): SemanticKindDefinition | undefined;
  hasSemanticKind(name: string): boolean;
  listSemanticKinds(): string[];

  // ── Adapters ──────────────────────────────────────────────
  registerAdapter(name: string, fn: AdapterFunction): void;
  getAdapter(name: string): AdapterFunction | undefined;
  hasAdapter(name: string): boolean;
  listAdapters(): string[];

  // ── Themes ────────────────────────────────────────────────
  registerTheme(name: string, stops: ColorStop[]): void;
  getTheme(name: string): ColorStop[] | undefined;
  hasTheme(name: string): boolean;
  listThemes(): string[];
}

// ─────────────────────────────────────────────────────────────
// Built-in semantic kinds
//
// Each built-in maps a SemanticKind to (component, adapter) plus an
// optional rendering preset. Adapter names follow the spec's
// `<source>-<format>` convention; these names are registered with
// their function bodies by `registerBuiltinAdapters()` at loader init.
// ─────────────────────────────────────────────────────────────

type BuiltinSemanticKindEntry = readonly [
  KnownSemanticKind,
  {
    readonly component: KnownComponentName;
    readonly adapter: KnownAdapterName;
    readonly rendering?: SemanticKindDefinition['rendering'];
  },
];

const BUILTIN_SEMANTIC_KINDS: readonly BuiltinSemanticKindEntry[] = [
  [
    'features',
    {
      component: 'nightingale-track-canvas',
      adapter: 'uniprot-features-json',
    },
  ],
  [
    'features-interpro',
    {
      component: 'nightingale-track-canvas',
      adapter: 'interpro-entries-json',
    },
  ],
  [
    'variants',
    {
      component: 'nightingale-variation',
      adapter: 'uniprot-variation-json',
    },
  ],
  [
    'variant-counts',
    {
      component: 'nightingale-linegraph-track',
      adapter: 'uniprot-variation-counts-json',
    },
  ],
  [
    'rna-editing',
    {
      component: 'nightingale-variation',
      adapter: 'uniprot-rna-editing-json',
    },
  ],
  [
    'rna-editing-counts',
    {
      component: 'nightingale-linegraph-track',
      adapter: 'uniprot-rna-editing-counts-json',
    },
  ],
  [
    'peptides',
    {
      component: 'nightingale-track-canvas',
      adapter: 'uniprot-proteomics-json',
    },
  ],
  [
    'peptides-ptm',
    {
      component: 'nightingale-track-canvas',
      adapter: 'uniprot-proteomics-ptm-json',
    },
  ],
  [
    'structure-coverage',
    {
      component: 'nightingale-track-canvas',
      adapter: 'uniprot-proteins-pdb-json',
    },
  ],
  [
    'confidence-score',
    {
      component: 'nightingale-colored-sequence',
      adapter: 'alphafold-prediction-json',
      rendering: { colorScale: { theme: 'alphafold-ramp' } },
    },
  ],
  [
    'pathogenicity-score',
    {
      component: 'nightingale-colored-sequence',
      adapter: 'alphamissense-average-csv',
      rendering: { colorScale: { theme: 'alphamissense-ramp' } },
    },
  ],
  [
    'pathogenicity-heatmap',
    {
      component: 'nightingale-sequence-heatmap',
      adapter: 'alphamissense-full-csv',
    },
  ],
];

// ─────────────────────────────────────────────────────────────
// Built-in colour themes
//
// Canonical, accessibility-reviewed palettes referenced by the
// `confidence-score` / `pathogenicity-score` semantic kinds. Custom
// themes may be added at runtime via `registerTheme()`.
// ─────────────────────────────────────────────────────────────

const ALPHAFOLD_RAMP: readonly ColorStop[] = [
  { value: 0, color: '#ff7d45', label: 'Very low' },
  { value: 50, color: '#ffdb13', label: 'Low' },
  { value: 70, color: '#65cbf3', label: 'Confident' },
  { value: 90, color: '#0053d6', label: 'Very high' },
];

const ALPHAMISSENSE_RAMP: readonly ColorStop[] = [
  { value: 0, color: '#3457b9', label: 'Benign' },
  { value: 0.5, color: '#d7d7d7', label: 'Ambiguous' },
  { value: 1, color: '#ca1615', label: 'Pathogenic' },
];

const BUILTIN_THEMES: ReadonlyArray<readonly [string, readonly ColorStop[]]> = [
  ['alphafold-ramp', ALPHAFOLD_RAMP],
  ['alphamissense-ramp', ALPHAMISSENSE_RAMP],
];

// ─────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────

/**
 * Thrown when the same name is registered twice in the same bucket
 * (semantic kinds, adapters, or themes). The spec's escape-hatch
 * docstrings require "unique … must not collide with built-ins"; a
 * silent override would make behaviour order-dependent.
 */
export class RegistryCollisionError extends Error {
  public readonly bucket: string;
  public readonly registeredName: string;
  constructor(bucket: string, name: string) {
    super(
      `Cannot register ${bucket} '${name}': a ${bucket} with this name is already registered.`
    );
    this.name = 'RegistryCollisionError';
    this.bucket = bucket;
    this.registeredName = name;
  }
}

// ─────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────

/**
 * Create a new registry seeded with all documented built-ins.
 *
 * The returned value is the single source of truth for name lookups
 * for one viewer instance. Multiple viewers on the same page can hold
 * independent registries so that custom registrations do not leak
 * between them.
 */
export function createRegistry(): Registry {
  const semanticKinds = new Map<string, SemanticKindDefinition>();
  const adapters = new Map<string, AdapterFunction>();
  const themes = new Map<string, ColorStop[]>();

  // Seed built-in semantic kinds. Rendering presets are copied
  // (shallow) so callers mutating the returned def do not mutate the
  // shared built-in table.
  for (const [name, def] of BUILTIN_SEMANTIC_KINDS) {
    semanticKinds.set(name, {
      component: def.component,
      adapter: def.adapter,
      ...(def.rendering
        ? { rendering: structuredCloneCompat(def.rendering) }
        : {}),
    });
  }

  // Seed built-in themes (array copy to prevent mutation).
  for (const [name, stops] of BUILTIN_THEMES) {
    themes.set(
      name,
      stops.map((s) => ({ ...s }))
    );
  }

  // ── register* helpers with collision detection ─────────────
  function registerInto<T>(
    bucket: string,
    map: Map<string, T>,
    name: string,
    value: T
  ): void {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError(
        `Cannot register ${bucket}: name must be a non-empty string.`
      );
    }
    if (map.has(name)) {
      throw new RegistryCollisionError(bucket, name);
    }
    map.set(name, value);
  }

  return {
    // ── Semantic kinds ──────────────────────────────────────
    registerSemanticKind(name, def) {
      registerInto('semantic kind', semanticKinds, name, def);
    },
    getSemanticKind(name) {
      return semanticKinds.get(name);
    },
    hasSemanticKind(name) {
      return semanticKinds.has(name);
    },
    listSemanticKinds() {
      return [...semanticKinds.keys()].sort();
    },

    // ── Adapters ────────────────────────────────────────────
    registerAdapter(name, fn) {
      registerInto('adapter', adapters, name, fn);
    },
    getAdapter(name) {
      return adapters.get(name);
    },
    hasAdapter(name) {
      return adapters.has(name);
    },
    listAdapters() {
      return [...adapters.keys()].sort();
    },

    // ── Themes ──────────────────────────────────────────────
    registerTheme(name, stops) {
      if (!Array.isArray(stops) || stops.length < 2) {
        throw new TypeError(
          `Cannot register theme '${name}': stops must be an array of at least 2 ColorStop entries.`
        );
      }
      registerInto(
        'theme',
        themes,
        name,
        stops.map((s) => ({ ...s }))
      );
    },
    getTheme(name) {
      return themes.get(name);
    },
    hasTheme(name) {
      return themes.has(name);
    },
    listThemes() {
      return [...themes.keys()].sort();
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

/**
 * `structuredClone` was added to jsdom late; fall back to JSON for
 * the small, plain-data rendering presets we seed with. The fallback
 * is fine because our built-in `rendering` blocks are pure data (no
 * functions, Dates, or Maps) — `JSON.parse(JSON.stringify(...))` is
 * a semantically equivalent clone for this shape.
 */
function structuredCloneCompat<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
