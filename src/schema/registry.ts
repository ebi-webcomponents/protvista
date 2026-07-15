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
 *   - Built-in semantic kinds and themes are seeded at construction,
 *     not through the public `register*` methods. User code attempting
 *     to register over one throws — the spec's escape-hatch docstrings
 *     say "must not collide with built-ins" and silent overrides would
 *     make the viewer's behaviour depend on call order.
 *   - Built-in *adapters* are the one exception, because they name a
 *     data format rather than a viewer behaviour: an adopter whose CSV
 *     has a different column layout needs to swap our `features-csv`
 *     for theirs. `createRegistry()` seeds them first (via
 *     `registerBuiltinAdapters()`, through the same public
 *     `registerAdapter()` path consumers use, so both share one
 *     namespace), and a consumer registering the same name afterwards
 *     overrides. That override is allowed once: registering a name
 *     that is not a built-in twice still throws, so a consumer
 *     colliding with their own adapter is caught as before. To add a
 *     built-in adapter, see `BUILTIN_ADAPTERS` in `./adapters`.
 *   - The 12 built-in semantic kinds reference adapter names that no
 *     built-in supplies. That is fine: `resolveSemanticKind()` returns
 *     the adapter *name* (a string), and the loader looks up the
 *     function at fetch time — the UniProt-API adapters reach it
 *     through the element's own adapter map rather than this registry.
 *   - `createRegistry()` is a factory (not a module-level singleton)
 *     so tests and downstream embedders can instantiate isolated
 *     registries. The `<protvista-uniprot>` element will hold one
 *     per instance.
 *
 * A Vega-Lite-style transform engine (with a transforms bucket
 * here for register/get/has/listTransforms +
 * BUILTIN_TRANSFORM_OPERATORS) is left as future work.
 */

import { BUILTIN_ADAPTERS } from './adapters';
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
// `<source>-<format>` convention; the loader resolves them to a
// function at fetch time.
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
      component: 'nightingale-variation-canvas',
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
      component: 'nightingale-variation-canvas',
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
      `Cannot register ${bucket} '${name}': ${
        /^[aeiou]/i.test(bucket) ? 'an' : 'a'
      } ${bucket} with this name is already registered.`
    );
    this.name = 'RegistryCollisionError';
    this.bucket = bucket;
    this.registeredName = name;
    // Maintain prototype chain across transpilation targets so that
    // `error instanceof RegistryCollisionError` works for consumers
    // that down-level this package to ES5.
    Object.setPrototypeOf(this, RegistryCollisionError.prototype);
  }
}

// ─────────────────────────────────────────────────────────────
// Built-in adapters
// ─────────────────────────────────────────────────────────────

/**
 * Register every built-in adapter onto `registry`.
 *
 * Called by `createRegistry()` so the built-ins are present before any
 * config loads. Registration goes through the public
 * `registerAdapter()` — built-ins and consumer adapters share one
 * namespace, and a consumer registering the same name afterwards
 * overrides the built-in.
 *
 * To add a built-in adapter, add a line to `BUILTIN_ADAPTERS` in
 * `./adapters`; this function needs no change.
 *
 * Not idempotent: calling it twice on the same registry re-registers
 * each name, which the second time around burns the built-in's
 * one permitted override.
 *
 * @throws if `BUILTIN_ADAPTERS` names an adapter twice — a library
 *   defect, not a consumer error. See the dedup guard below.
 */
export function registerBuiltinAdapters(registry: Registry): void {
  // Guard the table against itself. Without this, a duplicated row
  // surfaces as a RegistryCollisionError thrown from inside
  // `createRegistry()` — and since every element mount and every test
  // builds a registry, that reads as "the library is broken" rather
  // than "the table has a duplicate line". The table is edited one
  // line at a time by separate adapter tickets, so a copy-paste
  // duplicate is a realistic mistake worth naming precisely.
  const seen = new Set<string>();
  for (const [name] of BUILTIN_ADAPTERS) {
    if (seen.has(name)) {
      throw new Error(
        `BUILTIN_ADAPTERS (src/schema/adapters) registers '${name}' more than ` +
          `once. Each built-in adapter must appear exactly once — remove the ` +
          `duplicate entry.`
      );
    }
    seen.add(name);
  }

  for (const [name, fn] of BUILTIN_ADAPTERS) {
    registry.registerAdapter(name, fn);
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

  // Names seeded by `registerBuiltinAdapters()` below. A consumer may
  // register over any of these once; the name is dropped from the set
  // on override so a second registration collides like any other.
  const builtinAdapterNames = new Set<string>();
  let seedingBuiltinAdapters = false;

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

  const registry: Registry = {
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
      if (seedingBuiltinAdapters) {
        registerInto('adapter', adapters, name, fn);
        builtinAdapterNames.add(name);
        return;
      }
      if (builtinAdapterNames.has(name)) {
        // Consumer override of a built-in: allowed, and allowed once.
        // Forgetting the built-in status here means a second
        // registration of the same name collides like any other
        // consumer duplicate.
        builtinAdapterNames.delete(name);
        adapters.set(name, fn);
        return;
      }
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

  // Seed built-in adapters through the public path, exactly once, so a
  // config that names one loads without consumer-side registration.
  // The flag marks the names as overridable; it is safe because
  // `registerBuiltinAdapters` is synchronous.
  seedingBuiltinAdapters = true;
  try {
    registerBuiltinAdapters(registry);
  } finally {
    seedingBuiltinAdapters = false;
  }

  return registry;
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
