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
 *   2. Rendering options    — map to Nightingale component HTML attributes
 *   3. Component / adapter  — open string unions for built-ins + custom
 *   4. Semantic kinds       — author-facing stable vocabulary
 *   5. Escape-hatch API     — programmatic surface exposed at runtime
 *
 * The types are the source-of-truth for the JSON Schema authored in
 * `schema.json`. Any change here must be mirrored there and both
 * must stay in lockstep with `specs/config-approach.md`.
 *
 * A declarative `transform` pipeline (filter / calculate / rename /
 * pick / limit) is left as future work and is not currently
 * expressible in config.
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
 * against the item (e.g. `association.0.name`). The value at `path` is
 * coerced to string, HTML-escaped, and wrapped in `<p>` at the leaf.
 * Rich / interactive / stateful tooltips aren't a config concern —
 * consumers listen for the Nightingale `change` event, mount their
 * own UI, and set the `notooltip` attribute on the element to
 * suppress the library's built-in popover.
 *
 * Shape mirrors `FieldSpec` in `src/tooltips/types.ts`, restated here to
 * keep this file type-only / runtime-free. The two definitions must stay
 * in lockstep — the runtime module holds the canonical contract.
 */
interface AuthoredTooltipFieldSpec {
  path: string;
  label: string;
}

/**
 * Declarative label/value tooltip. Each entry becomes `<h5>label</h5>`
 * followed by the HTML-escaped value at `path`.
 */
interface AuthoredTooltipFieldsSpec {
  kind: 'fields';
  fields: AuthoredTooltipFieldSpec[];
}

/**
 * Markdoc template rendered against the item's fields. `{% $field %}`
 * interpolates scalars; `{% if %}` / `{% else %}` / `{% /if %}` gates
 * optional fragments.
 *
 * `variables` is merged into the Markdoc scope alongside the item's
 * fields, useful for threading track-level context (accession, trackId)
 * into per-item templates.
 */
interface AuthoredTooltipMarkdownSpec {
  kind: 'markdown';
  template: string;
  variables?: Record<string, unknown>;
}

/**
 * The YAML/JSON-authorable subset of the runtime `TooltipSpec`.
 * Identical in shape to `TooltipSpec` itself: the two `kind` variants
 * (`fields` and `markdown`) are both expressible in YAML, and there
 * is no programmatic-only variant. Rich / interactive tooltips are
 * not a config concern — they live in consumer code via the
 * event-listener pattern.
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
 * fields other than `groups` are optional; every field has a
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
   * (e.g. `"@my-org/base-config"` resolved via `opts.resolver`).
   * Resolution is left-to-right,
   * with later entries overriding earlier ones and the current
   * config overriding all of them.
   *
   * Merge rules are documented in `specs/config-approach.md`:
   *
   *   - `sources`          — merged by key (child wins)
   *   - `defaults`         — merged field-wise (child wins)
   *   - `groups`       — merged by `id`; a child group with a
   *                          known id extends the base; a new id is
   *                          appended at the end
   *   - `tracks` within a  — merged by `id`; same rules as groups
   *     merged group
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
   * Global defaults applied to every group/track unless overridden.
   *
   * Precedence (highest first):
   *   track.rendering > group.rendering > defaults.rendering
   *   track.labelUrl  > defaults.labelUrl
   *   track.helpPage  > group.helpPage > defaults.helpPage
   */
  defaults?: ConfigDefaults;

  /** Ordered list of groups displayed in the viewer. */
  groups: GroupConfig[];
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

export interface GroupConfig {
  /** Unique identifier for this group (e.g. `"MOLECULE_PROCESSING"`). */
  id: string;

  /**
   * Human-readable label shown in the UI. Optional — if omitted,
   * falls back to a title-cased form of `id`
   * (e.g. `"MOLECULE_PROCESSING"` → `"Molecule processing"`).
   */
  label?: string;

  /**
   * Short plain-text description shown as a native tooltip (the HTML
   * `title` attribute) when hovering the group label. Plain text
   * only — no Markdown, no HTML interpretation, no placeholders.
   */
  description?: string;

  /**
   * Component used for the collapsed / aggregate group-level
   * track. Optional — if omitted, inferred from the child tracks'
   * `kind`s. When all child tracks resolve to the same component,
   * that component is used; mixed components fall back to
   * `"nightingale-track-canvas"`.
   */
  component?: ComponentName;

  /** Ordered list of tracks within the group. Display order preserved. */
  tracks: TrackConfig[];

  /** Group-level rendering defaults; individual tracks inherit these. */
  rendering?: RenderingOptions;

  /** Optional URL slug for the help-page link on the group label. */
  helpPage?: string;
}

export interface TrackConfig {
  /** Unique identifier within its parent group (e.g. `"signal"`). */
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
   * Inherits from the parent group if neither `kind` nor
   * `component` is set on the track.
   */
  component?: ComponentName;

  /**
   * Data source(s) for this track. Accepts four shapes:
   *
   *   data: features                 # string shorthand (sources key)
   *   data: { url: "..." }           # single descriptor — the 95% case
   *   data: [ { ... }, { ... } ]     # array — multi-input adapter
   *
   * Shorthand resolution order:
   *
   *   - matches a key in root `sources`  → { from: url,  source: <value> }
   *   - starts with http:// or https://  → { from: url,  url: <value> }
   *
   * Adapter inference: the track's semantic `kind` selects the
   * canonical adapter for each `from: url` source.
   *
   * Generic-format adapters for bring-your-own-data files (CSV / TSV /
   * JSON / BED via file-path shorthand) is left as future work.
   * Today, authors with their own data files register a custom
   * adapter via `registerAdapter()` and pin it explicitly with
   * `adapter: <name>` on the descriptor.
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
   *      interpolates scalar fields; `{% if %}` / `{% /if %}` gates
   *      optional fragments.
   *
   *        dataTooltip: "### {% $name %}\n\n**Score:** `{% $score %}`"
   *
   *   2. **Fields form** — declarative label/value rows. No template
   *      syntax to learn; each row becomes `<h5>label</h5>` followed
   *      by the HTML-escaped value at `path`.
   *
   *        dataTooltip:
   *          kind: fields
   *          fields:
   *            - { path: name,        label: Name }
   *            - { path: description, label: Description }
   *
   *   3. **Template form** — explicit Markdoc spec, with optional
   *      extra variables merged into the Markdoc scope:
   *
   *        dataTooltip:
   *          kind: markdown
   *          template: "### {% $name %}\n{% if $score %}Score: {% $score %}{% /if %}"
   *          variables: { siteName: "my-viewer" }
   *
   * When set, overrides the per-kind default in `tooltipDefaults[kind]`.
   * When omitted, the built-in default is used. Rich / interactive
   * tooltips aren't a config concern — listen for the Nightingale
   * `change` event and mount your own UI (with `notooltip` on the
   * element to suppress the built-in popover).
   */
  dataTooltip?: string | AuthoredTooltipSpec;

  /**
   * Shortcut: show only items whose `type` field equals this value.
   * Most tracks that share an API endpoint with siblings (`SIGNAL`,
   * `CHAIN`, `DOMAIN`) only need this field to narrow by feature type.
   */
  filter?: string;

  /**
   * Attach a filter-UI widget alongside this track (currently: the
   * variant filter). This is a UI concern, not a data concern.
   */
  filterUI?: 'nightingale-filter';

  /** Track-level rendering overrides; merged on top of group defaults. */
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
}

// ─────────────────────────────────────────────────────────────
// 2. Rendering options
// ─────────────────────────────────────────────────────────────

/**
 * Rendering options that control the visual presentation of a track.
 * Map directly to Nightingale component HTML attributes.
 * Track-level values override group-level values, which override
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
// 3. Semantic kind vocabulary (author-facing)
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
// 4. Low-level component / adapter vocabulary
// ─────────────────────────────────────────────────────────────

/**
 * Low-level Nightingale component names. Authors should prefer
 * `SemanticKind`; use `component` only as an escape hatch when no
 * semantic kind matches.
 */
export type KnownComponentName =
  | 'nightingale-track-canvas'
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
 * coupling explicit — an author can tell at a glance which API a
 * built-in adapter is tied to (UniProt, AlphaFold, InterPro).
 *
 * Most authors never name an adapter directly — the semantic `kind`
 * field resolves to one automatically.
 *
 * Generic-format adapters for bring-your-own-data files (CSV / TSV /
 * JSON / BED) is left as future work. Today, authors with their own
 * data formats register a custom adapter via `registerAdapter()` and
 * pin it with `adapter: <name>` on the descriptor.
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
  | 'alphamissense-full-csv';

/** Open-ended `AdapterName`. Adapters registered via `registerAdapter()` also type-check. */
export type AdapterName = KnownAdapterName | (string & {});

// ─────────────────────────────────────────────────────────────
// 5. Escape-hatch API (programmatic — 20% advanced use cases)
// ─────────────────────────────────────────────────────────────

/**
 * Runtime API for advanced customisation.
 * Accessed via the `<protvista-uniprot>` element's JS API.
 *
 * The declarative config schema covers the 80% common case; this
 * API exists for the remaining 20% — registering custom adapters,
 * semantic kinds, or colour themes; injecting data programmatically;
 * subscribing to viewer events.
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
   * Register a custom colour-scale theme (see `ColorScaleConfig.theme`).
   */
  registerTheme(name: string, stops: ColorStop[]): void;

  /**
   * Provide data directly for a specific track, bypassing URL fetching.
   * Used with `DataSourceDescriptor.from = "custom"`.
   *
   * @param groupId — the group's `id`.
   * @param trackId    — the track's `id`.
   * @param data       — data conforming to the track's expected Representation.
   */
  setTrackData(groupId: string, trackId: string, data: unknown): void;

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
