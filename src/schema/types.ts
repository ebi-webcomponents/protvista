/**
 * ProtVista viewer configuration schema — TypeScript contract (v1).
 *
 * This file is the authoritative TypeScript type surface for the
 * `ProtvistaViewerConfig` schema described in `specs/config-approach.md`. It is intentionally
 * type-only and runtime-free: no imports, no executable code, nothing that
 * would pull into a consumer's bundle.
 *
 * Organisation follows the spec's data-model layering:
 *
 *   1. Intent layer         — ProtvistaViewerConfig + nested config types
 *   2. Transform vocabulary — Vega-Lite-inspired pipeline shape
 *   3. Rendering options    — map to Nightingale component HTML attributes
 *   4. Component / adapter  — open string unions for built-ins + custom
 *   5. Semantic kinds       — author-facing stable vocabulary
 *   6. Escape-hatch API     — programmatic surface exposed at runtime
 *
 * The types are the source-of-truth for the JSON Schema authored in
 * `schema.json` (#16). Any change here must be mirrored there and both
 * must stay in lockstep with `specs/config-approach.md`.
 *
 * The `(string & {})` idiom on ComponentName / AdapterName / SemanticKind
 * preserves IntelliSense for the built-in literals while still allowing
 * consumer-registered names (via `registerAdapter()`, `registerSemanticKind()`,
 * etc.) to type-check without widening to a bare `string`.
 */

// ─────────────────────────────────────────────────────────────
// Authored tooltip spec (subset of runtime TooltipSpec)
// ─────────────────────────────────────────────────────────────

/**
 * One row in a `fields`-form tooltip. `path` is a dotted property path
 * against the item (e.g. `association.0.name`). `render` names a helper
 * in the runtime `tooltipHelpers` registry; when omitted the value is
 * coerced to string, HTML-escaped, and wrapped in `<p>`.
 *
 * Shape mirrors `FieldSpec` in `src/tooltips/types.ts`, restated here to
 * keep this file type-only / runtime-free. The two definitions must stay
 * in lockstep — the runtime module holds the canonical contract.
 */
export interface AuthoredTooltipFieldSpec {
  path: string;
  label: string;
  render?: string;
}

/**
 * Declarative label/value tooltip. Each entry becomes `<h5>label</h5>`
 * followed by the value at `path`, optionally routed through a named
 * `tooltipHelpers` entry.
 */
export interface AuthoredTooltipFieldsSpec {
  kind: 'fields';
  fields: AuthoredTooltipFieldSpec[];
}

/**
 * Markdoc template rendered against the item's fields. `{% $field %}`
 * interpolates scalars; the registered tags `{% xrefs %}`, `{% evidence %}`,
 * and `{% link %}` produce formatted fragments.
 *
 * `variables` is merged into the Markdoc scope alongside the item's
 * fields, useful for threading track-level context (accession, trackId)
 * into per-item templates.
 */
export interface AuthoredTooltipMarkdownSpec {
  kind: 'markdown';
  template: string;
  variables?: Record<string, unknown>;
}

/**
 * The YAML/JSON-authorable subset of the runtime `TooltipSpec`. The
 * runtime also admits a `custom` variant (a JS render function); that's
 * unreachable from a config file and is instead supplied via the
 * `<protvista-uniprot>` element's `tooltips` property, which takes a
 * `TooltipSpec` registry keyed by semantic kind.
 */
export type AuthoredTooltipSpec =
  | AuthoredTooltipFieldsSpec
  | AuthoredTooltipMarkdownSpec;

// ─────────────────────────────────────────────────────────────
// 1. Intent layer
// ─────────────────────────────────────────────────────────────

/**
 * Root configuration object for a ProtVista viewer instance.
 *
 * A valid JSON (or YAML-parsed-to-object) value conforming to this
 * interface is sufficient to mount a fully functional viewer. All
 * fields other than `categories` are optional; every field has a
 * documented default or fallback in the spec's Behavior / Edge Cases
 * sections.
 *
 * Mounted three ways (highest priority wins for `accession`):
 *
 *   1. HTML attribute:  <protvista-uniprot accession="P05067">
 *   2. setConfig() call with `accession` in the config object
 *   3. YAML/JSON config file field
 */
export interface ProtvistaViewerConfig {
  /** JSON Schema URI for editor tooling (VS Code autocomplete etc.). */
  $schema?: string;

  /**
   * Schema version for forward-compatibility. Optional — defaults to
   * the current schema version (`"1.0"`) when omitted so beginner
   * configs can skip it entirely.
   */
  version?: '1.0';

  /**
   * Optional list of base configs to merge under this one.
   *
   * Each entry is a URL, a file path, or a registered preset name
   * (e.g. `"@ebi/uniprot-default"`). Resolution is left-to-right,
   * with later entries overriding earlier ones and the current
   * config overriding all of them.
   *
   * Merge rules are documented in `specs/config-approach.md`:
   *
   *   - `sources`          — merged by key (child wins)
   *   - `defaults`         — merged field-wise (child wins)
   *   - `categories`       — merged by `id`; a child category with a
   *                          known id extends the base; a new id is
   *                          appended at the end
   *   - `tracks` within a  — merged by `id`; same rules as categories
   *     merged category
   *   - `rendering` blocks — merged field-wise
   *
   * Cycles fail validation with `"Circular extends: a → b → a"`.
   */
  extends?: string | string[];

  /**
   * The primary accession or identifier for this viewer instance.
   * Used to interpolate `{accession}` placeholders in `sources`,
   * `labelUrl`, and any other template string in the config.
   *
   * If no accession is supplied (attribute, setConfig, or config file)
   * and the config contains `{accession}` placeholders, validation
   * fails with a clear message.
   */
  accession?: string;

  /**
   * Optional map of named URL templates. Tracks reference these by
   * key via `DataSourceDescriptor.source` (preferred) or implicitly
   * via a bare string `data:` value. URLs support `{accession}`
   * placeholder interpolation.
   */
  sources?: Record<string, string>;

  /**
   * Global defaults applied to every category/track unless overridden.
   *
   * Precedence (highest first):
   *   track.rendering > category.rendering > defaults.rendering
   *   track.labelUrl  > defaults.labelUrl
   *   track.helpPage  > category.helpPage > defaults.helpPage
   */
  defaults?: ConfigDefaults;

  /** Ordered list of categories displayed in the viewer. */
  categories: CategoryConfig[];
}

/**
 * Viewer-wide defaults. Every field is optional; anything unset falls
 * through to the component's own built-in defaults.
 */
export interface ConfigDefaults {
  /** Default rendering options inherited by every track. */
  rendering?: RenderingOptions;

  /**
   * Default `labelUrl` template for every track that does not set
   * its own. Supports `{accession}` and `{id}` placeholders.
   */
  labelUrl?: string;

  /** Default help-page slug. */
  helpPage?: string;
}

export interface CategoryConfig {
  /** Unique identifier for this category (e.g. `"MOLECULE_PROCESSING"`). */
  id: string;

  /**
   * Human-readable label shown in the UI. Optional — if omitted,
   * falls back to a title-cased form of `id`
   * (e.g. `"MOLECULE_PROCESSING"` → `"Molecule processing"`).
   */
  label?: string;

  /**
   * Short plain-text description shown as a native tooltip (the HTML
   * `title` attribute) when hovering the category label. Plain text
   * only — no Markdown, no HTML interpretation, no placeholders.
   */
  description?: string;

  /**
   * Component used for the collapsed / aggregate category-level
   * track. Optional — if omitted, inferred from the child tracks'
   * `kind`s. When all child tracks resolve to the same component,
   * that component is used; mixed components fall back to
   * `"nightingale-track-canvas"`.
   */
  component?: ComponentName;

  /** Ordered list of tracks within the category. Display order preserved. */
  tracks: TrackConfig[];

  /** Category-level rendering defaults; individual tracks inherit these. */
  rendering?: RenderingOptions;

  /** Optional URL slug for the help-page link on the category label. */
  helpPage?: string;
}

export interface TrackConfig {
  /** Unique identifier within its parent category (e.g. `"signal"`). */
  id: string;

  /** Human-readable label. Falls back to a title-cased form of `id`. */
  label?: string;

  /** URL for the label to link to. Supports `{accession}` and `{id}`. */
  labelUrl?: string;

  /**
   * Semantic track kind — describes WHAT the track displays.
   *
   * This is the primary way to declare a track's behaviour. The
   * runtime maps each semantic kind to a concrete Nightingale
   * component and data adapter, and may apply default rendering
   * presets (e.g. the AlphaFold colour ramp for `confidence-score`).
   *
   * Authors should prefer `kind` over the low-level `component` and
   * `adapter` fields — the semantic vocabulary shields configs from
   * future renderer changes.
   */
  kind?: SemanticKind;

  /**
   * Advanced: explicit Nightingale component override.
   * When set, used verbatim and semantic-kind resolution is skipped.
   * Inherits from the parent category if neither `kind` nor
   * `component` is set on the track.
   */
  component?: ComponentName;

  /**
   * Data source(s) for this track. Accepts four shapes:
   *
   *   data: features                 # string shorthand (sources key)
   *   data: ./hits.csv               # file-path shorthand
   *   data: { url: "..." }           # single descriptor — the 95% case
   *   data: [ { ... }, { ... } ]     # array — multi-input adapter
   *
   * Shorthand resolution order:
   *
   *   - matches a key in root `sources`  → { from: url,  source: <value> }
   *   - starts with http:// or https://  → { from: url,  url: <value> }
   *   - starts with / or ./              → { from: file, url: <value> }
   *   - ends with .csv                   → { from: file, adapter: features-csv }
   *   - ends with .tsv                   → { from: file, adapter: features-tsv }
   *   - ends with .json                  → { from: file, adapter: features-json }
   *   - ends with .bed                   → { from: file, adapter: bed }
   *
   * Adapter inference: when the shorthand doesn't pin an adapter by
   * extension, the track's semantic `kind` selects the canonical one.
   *
   * The array form is normalized internally; runtime code always sees
   * `DataSourceDescriptor[]`.
   */
  data: string | DataSourceDescriptor | DataSourceDescriptor[];

  /**
   * Short plain-text description shown as a native tooltip (the HTML
   * `title` attribute) when hovering the track label. Plain text
   * only — no Markdown, no HTML interpretation, no placeholders. For
   * per-datapoint tooltips use `dataTooltip`.
   */
  description?: string;

  /**
   * Per-item tooltip for this track. Three authoring forms:
   *
   *   1. **String shorthand** — a Markdoc template. `{% $field %}`
   *      interpolates scalar fields; `{% xrefs %}`, `{% evidence %}`,
   *      and `{% link %}` are pre-registered tags.
   *
   *        dataTooltip: "### {% $name %}\n\n**Score:** `{% $score %}`"
   *
   *   2. **Fields form** — declarative label/value rows. No template
   *      syntax to learn; each row becomes `<h5>label</h5>` followed
   *      by the value at `path`, optionally routed through a
   *      `tooltipHelpers` entry named in `render`.
   *
   *        dataTooltip:
   *          kind: fields
   *          fields:
   *            - { path: name,    label: Name }
   *            - { path: xrefs,   label: References, render: xrefs }
   *
   *   3. **Template form** — explicit Markdoc spec, with optional
   *      extra variables merged into the Markdoc scope:
   *
   *        dataTooltip:
   *          kind: markdown
   *          template: "### {% $name %}\n{% xrefs xrefs=$refs /%}"
   *          variables: { siteName: "my-viewer" }
   *
   * When set, overrides the per-kind default in `tooltipDefaults[kind]`.
   * When omitted, the built-in default is used. The runtime-only
   * `custom` form (JS render function) is not expressible here — it
   * reaches the resolver via `viewerConfig.tooltips[kind]`.
   */
  dataTooltip?: string | AuthoredTooltipSpec;

  /**
   * Shortcut: show only items whose `type` field equals this value.
   *
   * Equivalent to prepending
   *   `{ filter: { field: "type", equal: "<value>" } }`
   * to every data source's `transform` pipeline. Most tracks that
   * share an API endpoint with siblings (`SIGNAL`, `CHAIN`, `DOMAIN`)
   * only need this field and never touch `transform` directly.
   */
  filter?: string;

  /**
   * Attach a filter-UI widget alongside this track (currently: the
   * variant filter). This is a UI concern, not a data concern.
   */
  filterUI?: 'nightingale-filter';

  /** Track-level rendering overrides; merged on top of category defaults. */
  rendering?: RenderingOptions;

  /** Optional URL slug for the help-page link on the track label. */
  helpPage?: string;
}

/**
 * Describes how to obtain data for a track. The bridge between the
 * Intent layer (what to show) and the Representation layer (payloads
 * fed to Nightingale components).
 *
 * `from` is deliberately spelled this way (rather than `type`) so
 * that `type` stays available as a per-feature payload field (e.g.
 * `type: DOMAIN`) without YAML ambiguity.
 */
export interface DataSourceDescriptor {
  /**
   * Where data comes from. Defaults to `"url"` when omitted.
   *
   *   - `"url"`:    Fetch from one or more HTTP endpoints.
   *   - `"inline"`: Data is provided directly via `inlineData`.
   *   - `"file"`:   Path to a local file (Starter Kit / offline use).
   *   - `"custom"`: Consumer provides data programmatically via
   *                 `setTrackData()` (see ProtvistaRuntimeAPI).
   */
  from?: 'url' | 'inline' | 'file' | 'custom';

  /**
   * Explicit reference to a key in the root-level `sources` map.
   * Preferred over the `url` overload — makes intent obvious.
   */
  source?: string | string[];

  /**
   * Literal URL(s) for `from: url`, or the file path for `from: file`.
   *
   * Back-compat overload: a bare string that is not an http(s) URL
   * and not an absolute/relative path is still resolved via the
   * `sources` map. Prefer `source:` for new configs.
   *
   * Supports the `{accession}` placeholder.
   */
  url?: string | string[];

  /**
   * For `from: inline`: the data payload provided directly in the
   * config. Must conform to the adapter's expected input schema
   * (or the track's expected Representation schema if no adapter
   * is set).
   */
  inlineData?: unknown;

  /**
   * Named adapter that transforms the raw response into the shape
   * the Nightingale track component expects. If omitted, the raw
   * response is passed directly to the track; when `data` is a
   * string shorthand, the adapter is inferred from file extension
   * or the parent track's semantic `kind`.
   */
  adapter?: AdapterName;

  /**
   * Declarative transformations applied to the adapter's output
   * *before* the track renders. Ordered: each step's output is
   * the next step's input.
   *
   * The vocabulary is a subset of Vega-Lite's `transform` pipeline
   * (https://vega.github.io/vega-lite/docs/transform.html). Field
   * predicate operators match
   * (https://vega.github.io/vega-lite/docs/filter.html).
   *
   * Most configs never need this — the track-level `filter` shortcut
   * covers the common "pick items of a given type" case, and canonical
   * adapters produce ready-to-render output.
   */
  transform?: Transform[];
}

// ─────────────────────────────────────────────────────────────
// 2. Transform vocabulary
// ─────────────────────────────────────────────────────────────

/**
 * A single step in the data pipeline. Discriminated by which
 * operation key is present. Exactly one operation per step.
 *
 * Shape mirrors Vega-Lite's `transform` entries. A `registerTransform()`
 * escape hatch lets advanced users add custom operators while keeping
 * the same discriminated-union shape.
 */
export type Transform =
  /** Keep only items matching a predicate (structured or expression). */
  | { filter: FieldPredicate | string }
  /** Compute a derived field from an expression. */
  | { calculate: string; as: string }
  /** Rename fields on each item. Keys are old names, values new names. */
  | { rename: Record<string, string> }
  /** Project each item to only the named fields. */
  | { pick: string[] }
  /** Keep at most N items (items beyond the limit are dropped). */
  | { limit: number };

/**
 * A structured field predicate, shape-compatible with Vega-Lite's
 * Field Predicate
 * (https://vega.github.io/vega-lite/docs/filter.html#field-predicate).
 *
 * Exactly one comparison operator must be present alongside `field`:
 *
 *     { field: "score", gte: 0.8 }
 *     { field: "type",  oneOf: ["DOMAIN", "REGION"] }
 *     { field: "score", range: [0.5, 0.9] }
 *     { field: "start", valid: true }             // excludes null / NaN
 *
 * The expression-string form of `filter` accepts any Vega-compatible
 * predicate, e.g. `"datum.score > 0.8 && datum.type == 'DOMAIN'"`.
 */
export interface FieldPredicate {
  field: string;
  equal?: unknown;
  lt?: number | string;
  lte?: number | string;
  gt?: number | string;
  gte?: number | string;
  oneOf?: unknown[];
  range?: [unknown, unknown];
  valid?: boolean;
}

// ─────────────────────────────────────────────────────────────
// 3. Rendering options
// ─────────────────────────────────────────────────────────────

/**
 * Rendering options that control the visual presentation of a track.
 * Map directly to Nightingale component HTML attributes.
 * Track-level values override category-level values, which override
 * `defaults.rendering`.
 */
export interface RenderingOptions {
  /** CSS colour string for feature glyphs. */
  color?: string;

  /** Shape of feature glyphs (e.g. `"rectangle"`, `"circle"`, `"diamond"`). */
  shape?: string;

  /** Height of the track in pixels. */
  height?: number;

  /** Layout mode. Defaults to `"non-overlapping"`. */
  layout?: 'non-overlapping' | 'default';

  /**
   * Continuous colour scale for colored-sequence and heatmap tracks.
   *
   * Maps numeric values to colours via a gradient with named stops.
   * If omitted, the Nightingale component's built-in default is used.
   * Semantic kinds `confidence-score` and `pathogenicity-score`
   * carry canonical defaults (`"alphafold-ramp"` /
   * `"alphamissense-ramp"`) for free.
   */
  colorScale?: ColorScaleConfig;
}

/**
 * A continuous colour gradient.
 *
 * Specified EITHER by a named theme (preferred — accessible,
 * theme-aware) OR by explicit ordered stops (escape hatch for
 * one-off custom scales). When both are present, explicit stops
 * take precedence — useful for "start from a named theme and
 * override a single stop."
 *
 * Built-in themes:
 *   - `"alphafold-ramp"`      — pLDDT confidence ramp (very low → very high)
 *   - `"alphamissense-ramp"`  — pathogenicity ramp (benign → pathogenic)
 *
 * Custom themes can be registered at runtime via `registerTheme()`.
 *
 * Validation: if neither `theme` nor `stops` is present, config
 * validation fails.
 */
export interface ColorScaleConfig {
  /** Named theme (see list above). Preferred. */
  theme?: string;

  /** Explicit colour stops. Use only when no theme matches your data. */
  stops?: ColorStop[];
}

export interface ColorStop {
  /** The numeric threshold for this stop. */
  value: number;

  /** CSS colour at this threshold (hex, rgb, or named colour). */
  color: string;

  /** Optional human-readable label (e.g. `"Very high"`, `"Pathogenic"`). */
  label?: string;
}

// ─────────────────────────────────────────────────────────────
// 4. Semantic kind vocabulary (author-facing)
// ─────────────────────────────────────────────────────────────

/**
 * Built-in semantic track kinds.
 *
 * Describes biological data kinds rather than rendering components.
 * Each kind resolves to a concrete (component, adapter) pair and may
 * carry a default rendering preset.
 *
 * This is the stable vocabulary for config authors. The list grows
 * by addition — existing kinds will not be repointed to different
 * renderers without a major version bump.
 */
export type KnownSemanticKind =
  /** Generic UniProt-style features. Combine with `filter` to subset by type. */
  | 'features'
  /** InterPro domain hits (representative). */
  | 'features-interpro'
  /** Natural or disease-associated variants with detail panel. */
  | 'variants'
  /** Per-position variant count (line graph). */
  | 'variant-counts'
  /** RNA editing events rendered as variants. */
  | 'rna-editing'
  /** Per-position RNA editing count (line graph). */
  | 'rna-editing-counts'
  /** Proteomics peptide evidence. */
  | 'peptides'
  /** PTM-containing peptides (large-scale MS). */
  | 'peptides-ptm'
  /** PDB structure coverage intervals. */
  | 'structure-coverage'
  /** AlphaFold per-residue confidence (pLDDT). Includes default colour ramp. */
  | 'confidence-score'
  /** AlphaMissense per-residue pathogenicity. Includes default colour ramp. */
  | 'pathogenicity-score'
  /** AlphaMissense per-position × amino-acid heatmap. */
  | 'pathogenicity-heatmap';

/**
 * Open-ended `SemanticKind`. Kinds registered at runtime via
 * `registerSemanticKind()` are also valid. The `(string & {})`
 * suffix preserves IntelliSense for the built-ins without narrowing
 * the type to just that closed set.
 */
export type SemanticKind = KnownSemanticKind | (string & {});

// ─────────────────────────────────────────────────────────────
// 5. Low-level component / adapter vocabulary
// ─────────────────────────────────────────────────────────────

/**
 * Low-level Nightingale component names. Authors should prefer
 * `SemanticKind`; use `component` only as an escape hatch when no
 * semantic kind matches.
 */
export type KnownComponentName =
  | 'nightingale-track-canvas'
  | 'nightingale-interpro-track'
  | 'nightingale-colored-sequence'
  | 'nightingale-variation'
  | 'nightingale-linegraph-track'
  | 'nightingale-sequence-heatmap';

/**
 * Open-ended `ComponentName`. Consumers may pass any custom
 * Nightingale-compatible element tag name here.
 */
export type ComponentName = KnownComponentName | (string & {});

/**
 * Named data adapters.
 *
 * Naming convention: `<source>-<format>`. This makes each adapter's
 * coupling explicit — an author can tell at a glance whether an
 * adapter is tied to a specific API (UniProt, AlphaFold, InterPro)
 * or parses a generic format (JSON array, CSV, BED).
 *
 * Most authors never name an adapter directly — the semantic `kind`
 * field resolves to one automatically.
 */
export type KnownAdapterName =
  // ── Source-specific (coupled to a particular API output) ──
  | 'uniprot-features-json'
  | 'uniprot-variation-json'
  | 'uniprot-variation-counts-json'
  | 'uniprot-proteomics-json'
  | 'uniprot-proteomics-ptm-json'
  | 'uniprot-rna-editing-json'
  | 'uniprot-rna-editing-counts-json'
  | 'uniprot-proteins-pdb-json'
  | 'interpro-entries-json'
  | 'alphafold-prediction-json'
  | 'alphamissense-average-csv'
  | 'alphamissense-full-csv'
  // ── Generic format adapters (bring your own data) ─────────
  /** Array of feature objects already in expected shape. */
  | 'features-json'
  /** CSV with columns: `type,start,end,description[,score]`. */
  | 'features-csv'
  /** TSV (tab-separated) with the same columns as `features-csv`. */
  | 'features-tsv'
  /** Standard BED (tab-separated). */
  | 'bed';

/** Open-ended `AdapterName`. Adapters registered via `registerAdapter()` also type-check. */
export type AdapterName = KnownAdapterName | (string & {});

// ─────────────────────────────────────────────────────────────
// 6. Escape-hatch API (programmatic — 20% advanced use cases)
// ─────────────────────────────────────────────────────────────

/**
 * Runtime API for advanced customisation.
 * Accessed via the `<protvista-uniprot>` element's JS API.
 *
 * The declarative config schema covers the 80% common case; this
 * API exists for the remaining 20% — registering custom adapters,
 * semantic kinds, transforms, or colour themes; injecting data
 * programmatically; subscribing to viewer events.
 */
export interface ProtvistaRuntimeAPI {
  /**
   * Register a custom adapter so it can be referenced by name in
   * config. The name must not collide with built-ins.
   */
  registerAdapter(name: string, fn: AdapterFunction): void;

  /**
   * Register a custom semantic kind so community-defined data types
   * can be authored with the same ergonomic `kind:` surface as
   * built-ins, rather than falling back to explicit `component` +
   * `adapter` pairs.
   *
   * Example:
   *
   *     api.registerSemanticKind("crispr-guides", {
   *       component: "nightingale-track-canvas",
   *       adapter:   "my-crispr-json",
   *       rendering: { shape: "diamond", color: "#8e44ad" },
   *     });
   *
   *     // then in config:
   *     // - kind: crispr-guides
   *     //   data: guides
   */
  registerSemanticKind(name: string, def: SemanticKindDefinition): void;

  /**
   * Register a custom transform operator so it can appear as a step
   * in `DataSourceDescriptor.transform`. The operator name becomes
   * the discriminator key in the transform step object.
   *
   * Example:
   *
   *     api.registerTransform("aggregateBy", (items, params) => { ... });
   *
   *     # in config:
   *     transform:
   *       - aggregateBy: { field: type, op: count }
   */
  registerTransform(name: string, fn: TransformFunction): void;

  /**
   * Register a custom colour-scale theme (see `ColorScaleConfig.theme`).
   */
  registerTheme(name: string, stops: ColorStop[]): void;

  /**
   * Provide data directly for a specific track, bypassing URL fetching.
   * Used with `DataSourceDescriptor.from = "custom"`.
   *
   * @param categoryId — the category's `id`.
   * @param trackId    — the track's `id`.
   * @param data       — data conforming to the track's expected Representation.
   */
  setTrackData(categoryId: string, trackId: string, data: unknown): void;

  /**
   * Replace the entire viewer configuration at runtime. Triggers a
   * full re-render.
   */
  setConfig(config: ProtvistaViewerConfig): void;

  /** Subscribe to viewer events (selection, zoom, data-loaded). */
  on(event: string, callback: (detail: unknown) => void): void;
}

/**
 * The payload registered via `registerSemanticKind()` — a
 * (component, adapter) pair plus an optional rendering preset.
 */
export interface SemanticKindDefinition {
  component: ComponentName;
  adapter: AdapterName;
  rendering?: RenderingOptions;
}

/**
 * Signature of a custom adapter registered via `registerAdapter()`.
 * Receives one or more raw responses (one per entry in a track's
 * `data` array) and returns the shape the Nightingale component
 * expects.
 */
export type AdapterFunction = (
  ...rawResponses: unknown[]
) => unknown | Promise<unknown>;

/**
 * Signature of a custom transform operator registered via
 * `registerTransform()`. Receives the current items array and the
 * operator's parameters, returns the transformed items.
 */
export type TransformFunction = (
  items: unknown[],
  params: unknown
) => unknown[] | Promise<unknown[]>;
