# Spec: ProtVista Viewer Configuration Schema (v1)

## Purpose

Make ProtVista a **low-friction tool** that external labs, bioinformaticians, and non-EBI integrators can point at their own data and view it — ideally without writing JavaScript. To that end, this spec defines a JSON configuration schema that fully describes a ProtVista viewer instance: the categories it displays, the tracks within each category, where data comes from, and how tracks are rendered. The viewer is assembled declaratively from a single configuration file instead of hardcoded logic. The schema cleanly separates **Intent** (what the viewer should show and how) from **Representation** (the data payloads that tracks consume), and it preserves escape hatches for advanced programmatic customisation when the declarative path is not enough.

The bring-your-own-data path is a first-class use case, not an afterthought — see the [Starter Kit](#starter-kit) section for the concrete deliverable that exercises it.

### Ownership boundaries

This schema is ProtVista's concern. Nightingale does not own the configuration format, semantic kind vocabulary, adapter naming conventions, colour-scale themes, or tooltip templates — those are all ProtVista concerns defined in this spec. ProtVista deliberately does not couple itself to specific cross-viewer protocols during the grant period; alignment with emerging standards like SVS is a long-term goal to be revisited outside the grant (see [Relationship to 3D viewers](#relationship-to-3d-viewers-molstar--svs)).

## Quick look

The target workflow — an external lab inheriting the full EBI UniProt viewer and adding one custom track with a handful of lines of YAML:

```yaml
# Inherit the published EBI UniProt config, then add one custom track.
# Nothing else needs to be restated — `sources`, `defaults`, all 15 EBI
# categories, every built-in colour theme: all pulled in from the base.
extends: "@ebi/uniprot-default"

categories:
  - id: MY_LAB
    label: My lab
    tracks:
      - id: hotspots
        kind: features
        data: ./hotspots.csv
```

A bench scientist writes only domain-level concepts (`kind: features`, `./hotspots.csv`) — never Nightingale component names, adapter names, or JavaScript. See [Example 5](#example-5-extending-the-ebi-default--one-line-one-new-track) for the full behaviour, and [Example 4](#example-4-bring-your-own-csv-with-a-vega-lite-transform-pipeline) for the bring-your-own-CSV + transform-pipeline variant.

## Non-Goals

- Defining the payload/data schemas for individual track types or adapters (those will be specified separately per track type; this schema only references them by name).
- Implementing the runtime config loader, validator, or UI (this spec defines the *contract*; implementation is a separate task).
- Redesigning the underlying Nightingale component API. The resolver translates this schema onto the existing Nightingale attribute surface; changes to Nightingale itself are out of scope.
- Supporting components not currently implemented in Nightingale (the schema is extensible, but v1 covers the six existing `ComponentName` values).
- Deep integration with SVS or any equivalent cross-viewer protocol during the grant. Alignment with SVS is a long-term goal outside the grant. Where individual ideas from SVS fit naturally into ProtVista's low-friction model (e.g. the `kind` discriminator used below), they may be adopted à la carte without committing to the full protocol — see [Relationship to 3D viewers](#relationship-to-3d-viewers-molstar--svs).
- Handling viewer-to-viewer synchronisation, whether ProtVista↔ProtVista or ProtVista↔3D. The existing `nightingale-structure` SIFTS path continues to provide 1D↔3D coordination for standalone deployments and is unchanged by this spec.
- Implementing the transform operators or the Vega-style expression evaluator. The schema defines the *shape* of `transform` steps and field predicates; the `filter` / `calculate` / `rename` / `pick` / `limit` execution, and the parser for Vega expression strings, live in runtime code outside this spec.
- Specifying runtime UI state. Track reordering, individual track collapse/toggle, and other user-driven UI interactions are orthogonal to the config schema — the config describes the *initial mount*; any subsequent UI state lives in the viewer component, not in the config.

## Data Model

The schema is split into two conceptual layers:

1. **Intent** — the `ProtvistaViewerConfig` object that describes *what* the viewer should display and *how*.
2. **Representation** — the data payloads returned by adapters and consumed by Nightingale track components. This spec does not define payload schemas, but the `DataSourceDescriptor` within Intent declares how to obtain them.

### Intent Layer

```typescript
/**
 * Root configuration object for a ProtVista viewer instance.
 * A valid JSON file conforming to ProtvistaViewerConfig is sufficient
 * to mount a fully functional viewer.
 */
interface ProtvistaViewerConfig {
  /** JSON Schema URI for editor tooling. */
  $schema?: string;

  /**
   * Schema version for forward-compatibility. Optional — defaults to
   * the current schema version ("1.0") if omitted, so beginner configs
   * can skip it entirely. Set explicitly when authoring against a
   * specific published schema version.
   */
  version?: "1.0";

  /**
   * Optional list of base configs to merge under this one.
   *
   * Each entry is a URL, a file path, or a registered preset name
   * (e.g. `"@ebi/uniprot-default"`). Resolution is left-to-right,
   * with later entries overriding earlier ones and the current
   * config overriding all of them.
   *
   * Merge semantics:
   *   - `sources`            merged by key (child wins)
   *   - `defaults`           merged field-wise (child wins)
   *   - `categories`         merged by `id`; a child category with a
   *                          known id extends the base; a new id is
   *                          appended at the end
   *   - `tracks` within a    merged by `id`; same rules as categories
   *     merged category
   *   - `rendering` blocks   merged field-wise
   *
   * The canonical use case is "start from the EBI UniProt default,
   * add one track":
   *
   *   extends: "@ebi/uniprot-default"
   *   categories:
   *     - id: MY_TRACKS
   *       tracks:
   *         - id: hotspots
   *           kind: features
   *           data: ./hotspots.csv
   */
  extends?: string | string[];

  /**
   * The primary accession or identifier for this viewer instance.
   *
   * Used to interpolate `{accession}` placeholders in `sources`
   * URLs, `labelUrl`, and any other template string in the config.
   * Only characters matching `[A-Za-z0-9_-]{1,32}` are substituted;
   * all other values substitute to an empty string. This prevents
   * path traversal and URL-smuggling payloads from user input.
   *
   * Can be supplied in three ways (highest priority wins):
   *
   *   1. HTML attribute:  <protvista-uniprot accession="P05067">
   *   2. setConfig() call with `accession` in the config object
   *   3. YAML/JSON config file
   *
   * The attribute takes precedence so that the same config file can
   * be reused across entries — the mounting code just changes the
   * attribute.  When the config declares an accession and no
   * attribute is present, the config value is used, making the
   * config fully self-contained (useful for the Starter Kit and
   * for sharing reproducible examples).
   *
   * If no accession is supplied by any source and the config
   * contains `{accession}` placeholders, validation emits:
   *   "Config contains {accession} placeholders but no accession
   *    was provided via attribute or config."
   */
  accession?: string;

  /**
   * Optional map of named URL templates.
   *
   * Tracks reference these by key name in `DataSourceDescriptor.source`
   * (preferred) or implicitly via a bare `url` value that is not an
   * http(s) URL or a file path. URLs support `{accession}` placeholder
   * interpolation.
   *
   * Example:
   *   sources: {
   *     "features":  "https://www.ebi.ac.uk/proteins/api/features/{accession}",
   *     "variation": "https://www.ebi.ac.uk/proteins/api/variation/{accession}",
   *     "proteins":  "https://www.ebi.ac.uk/proteins/api/proteins/{accession}"
   *   }
   *
   *   // In a track's data block:
   *   source: "features"             // explicit, preferred
   *   data: features                 // shorthand form (string as `source`)
   *   url: "https://my.lab/data"     // literal URL
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
interface ConfigDefaults {
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

interface CategoryConfig {
  /** Unique identifier for this category (e.g. "MOLECULE_PROCESSING"). */
  id: string;

  /**
   * Human-readable label shown in the UI. Optional — if omitted,
   * falls back to a title-cased form of `id`
   * (e.g. "MOLECULE_PROCESSING" → "Molecule processing").
   */
  label?: string;

  /**
   * Component used for the *collapsed / aggregate* category-level
   * track. Optional — if omitted, inferred from the child tracks'
   * `kind`s. When all child tracks resolve to the same component,
   * that component is used; mixed components fall back to
   * `nightingale-track-canvas`.
   */
  component?: ComponentName;

  /** Ordered list of tracks within the category. Order determines display order. */
  tracks: TrackConfig[];

  /**
   * Short plain-text description shown when hovering the category
   * label. Rendered via the native HTML `title=` attribute — no
   * Markdown, no HTML, no placeholder interpolation. Mirror of the
   * track-level `description` field.
   */
  description?: string;

  /** Category-level rendering defaults; individual tracks inherit these. */
  rendering?: RenderingOptions;

  /** Optional URL slug for the help-page link on the category label. */
  helpPage?: string;
}

interface TrackConfig {
  /** Unique identifier within its parent category (e.g. "signal"). */
  id: string;

  /** Human-readable label. Falls back to a title-cased form of `id` if omitted. */
  label?: string;

  /** URL for the label to link to. Supports `{accession}` and `{id}` interpolation. */
  labelUrl?: string;

  /**
   * Semantic track kind — describes WHAT the track displays.
   *
   * This is the primary way to declare a track's behaviour. It is
   * a small, stable vocabulary of biological data kinds. The
   * runtime maps each semantic kind to a concrete Nightingale
   * component and data adapter, and may apply default rendering
   * presets (e.g. the AlphaFold colour ramp for `confidence-score`).
   *
   * Authors should prefer this field over the low-level `component`
   * and `adapter` fields — the semantic vocabulary shields configs
   * from future renderer changes.
   */
  kind?: SemanticKind;

  /**
   * Advanced: explicit Nightingale component override.
   * When set, used verbatim and semantic-kind resolution is skipped.
   * Inherit from the parent category if neither `kind` nor
   * `component` is set on the track.
   */
  component?: ComponentName;

  /**
   * Data source(s) for this track.
   *
   * Accepts four shapes, in order of author effort:
   *
   *   data: features                 # string shorthand
   *   data: ./hits.csv               # file-path shorthand
   *   data: { url: "..." }           # single descriptor — the 95% case
   *   data: [ { ... }, { ... } ]     # array — multi-input adapter (AlphaFold)
   *
   * String-shorthand resolution rules (checked in order):
   *
   *   - matches a key in root `sources`  → from: url,    source: <value>
   *   - starts with http:// or https://  → from: url,    url: <value>
   *   - starts with / or ./              → from: file,   url: <value>
   *   - ends with .csv                   → from: file,   adapter: features-csv
   *   - ends with .tsv                   → from: file,   adapter: features-tsv
   *   - ends with .json                  → from: file,   adapter: features-json
   *   - ends with .bed                   → from: file,   adapter: bed
   *
   * Adapter inference: for any shorthand that doesn't pin down an
   * adapter by extension, the track's semantic `kind` selects the
   * canonical adapter.
   *
   * The array form is normalized internally; runtime code always
   * sees `DataSourceDescriptor[]`.
   */
  data: DataSourceDescriptor | DataSourceDescriptor[] | string;

  /**
   * Short plain-text description shown when hovering the track LABEL
   * (the left-hand track header, not individual data points). Rendered
   * via the native HTML `title=` attribute — no Markdown, no HTML,
   * no placeholder interpolation. For per-datapoint tooltips, use
   * `dataTooltip`.
   */
  description?: string;

  /**
   * Per-datapoint tooltip spec. Three authoring forms are accepted;
   * the shorthand string form is syntactic sugar for the markdown
   * form:
   *
   *   // Shorthand — equivalent to { kind: "markdown", template: "..." }
   *   dataTooltip: "### {% $name %}\n**Score:** {% $score %}"
   *
   *   // Field list — emits <h5>label</h5><p>value</p> per populated
   *   // entry, with dotted paths and optional named helpers:
   *   dataTooltip:
   *     kind: fields
   *     fields:
   *       - path: name
   *         label: Name
   *       - path: xrefs
   *         label: Cross-references
   *         render: xrefs
   *
   *   // Markdoc template — full Markdoc syntax with `{% $field %}`
   *   // variable interpolation and built-in tags `{% link %}`,
   *   // `{% xrefs %}`, `{% evidence %}`:
   *   dataTooltip:
   *     kind: markdown
   *     template: |
   *       ### {% $description %}
   *       {% if $evidences %}{% evidence codes=$evidences /%}{% /if %}
   *
   * When omitted, the track falls back to the built-in default for
   * the semantic `kind` (if any), then to an auto-fallback synthesized
   * from common feature-shaped fields (`type`, `description`,
   * `start | begin`, `end`). Resolution precedence is
   * `tooltipOverrides[kind] > track.dataTooltip > tooltipDefaults[kind] > auto-fallback`.
   * The auto-fallback is a sensible-default path: if an adapter already
   * stashed a `tooltipContent` on the item, the loader leaves it alone.
   *
   * Interpolated field values are HTML-escaped before they enter the
   * Markdoc render, so a malicious adapter payload cannot smuggle
   * raw HTML into a tooltip. Missing fields render as empty strings.
   */
  dataTooltip?: string | AuthoredTooltipSpec;

  /**
   * Shortcut: show only items whose `type` field equals this value.
   *
   * Equivalent to prepending
   *   { filter: { field: "type", equal: "<value>" } }
   * to every data source's `transform` pipeline. Most tracks that
   * share an API endpoint with sibling tracks (`SIGNAL`, `CHAIN`,
   * `DOMAIN`, …) only need this field and never touch `transform`
   * directly.
   */
  filter?: string;

  /**
   * Attach a filter-UI widget alongside this track (currently: the
   * variant filter). This is a UI concern, not a data concern.
   */
  filterUI?: "nightingale-filter";

  /** Track-level rendering overrides; merged on top of category defaults. */
  rendering?: RenderingOptions;

  /** Optional URL slug for the help-page link on the track label. */
  helpPage?: string;
}

/**
 * The YAML/JSON-authorable subset of `TooltipSpec`. Excludes the
 * `custom` branch because a `render` function has no representation
 * in a declarative config file — authors who need `custom` reach for
 * the programmatic escape hatch (`tooltipOverrides[kind] = { kind:
 * "custom", render }`) on the runtime API instead.
 */
type AuthoredTooltipSpec =
  | {
      kind: "fields";
      fields: {
        /** Dotted path into the adapter's output item. */
        path: string;
        /** Human-readable label rendered above the value. */
        label: string;
        /**
         * Optional name of a helper registered on `tooltipHelpers`
         * (built-ins: `xrefs`, `evidence`). Unknown names fall
         * through to default escaped-value rendering.
         */
        render?: string;
      }[];
    }
  | {
      kind: "markdown";
      /** Markdoc source with `{% $field %}` variable interpolation. */
      template: string;
      /** Extra scope merged alongside the adapter item at render time. */
      variables?: Record<string, unknown>;
    };

/**
 * Describes how to obtain data for a track. Bridge between Intent
 * and Representation.
 */
interface DataSourceDescriptor {
  /**
   * Where data comes from. Defaults to "url" if omitted.
   *
   * `from` is deliberately spelled this way (rather than `type`)
   * because `type` is commonly used as a per-feature data field
   * (e.g. `type: DOMAIN`). Reserving `type` for the payload keeps
   * YAML (`from: file, url: ./x.csv`) unambiguous.
   *
   * - "url":    Fetch from one or more HTTP endpoints.
   * - "inline": Data is provided directly via `inlineData`.
   * - "file":   Path to a local file (for the Starter Kit / offline use).
   * - "custom": Consumer provides data programmatically via the escape-hatch API.
   */
  from?: "url" | "inline" | "file" | "custom";

  /**
   * Explicit reference to a key in the root-level `sources` map.
   * Preferred over the `url` overload below — makes intent obvious
   * at a glance.
   *
   *   sources:
   *     features: https://www.ebi.ac.uk/proteins/api/features/{accession}
   *
   *   # in a track:
   *   data:
   *     source: features             # ← explicit and self-documenting
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
   * For `from: inline`: the data payload provided directly in the config.
   * Must conform to the adapter's expected input schema (or the
   * track's expected Representation schema if no adapter is set).
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
   * *before* the track renders. Ordered: each step's output is the
   * next step's input.
   *
   * The vocabulary is a subset of Vega-Lite's `transform` pipeline
   * (https://vega.github.io/vega-lite/docs/transform.html) so that
   * authors familiar with Vega-Lite, Altair, or Observable Plot
   * reuse existing knowledge. Field predicate operators (`equal`,
   * `lt`, `lte`, `gt`, `gte`, `oneOf`, `range`, `valid`) match
   * Vega-Lite's (https://vega.github.io/vega-lite/docs/filter.html).
   *
   * Most configs never need this — the track-level `filter` shortcut
   * covers the common "pick items of a given type" case, and
   * canonical adapters produce ready-to-render output. `transform`
   * exists for the "almost right, just need to tweak" cases that
   * would otherwise require writing a custom adapter.
   */
  transform?: Transform[];
}

/**
 * A single step in the data pipeline. Discriminated by which
 * operation key is present (`filter` | `calculate` | `rename` |
 * `pick` | `limit`). Exactly one operation per step.
 *
 * Shape mirrors Vega-Lite's `transform` entries. A `registerTransform()`
 * escape-hatch (see ProtvistaRuntimeAPI) lets advanced users add
 * custom operators while keeping the same discriminated-union shape.
 */
type Transform =
  /** Keep only items matching a predicate (structured or expression). */
  | { filter: FieldPredicate | string }
  /** Compute a derived field from an expression. */
  | { calculate: string; as: string }
  /** Rename fields on each item. Keys are old names, values are new names. */
  | { rename: Record<string, string> }
  /** Project each item to only the named fields. */
  | { pick: string[] }
  /** Keep at most N items (items beyond the limit are dropped). */
  | { limit: number };

/**
 * A structured field predicate, shape-compatible with Vega-Lite's
 * Field Predicate (https://vega.github.io/vega-lite/docs/filter.html#field-predicate).
 *
 * Exactly one comparison operator must be present alongside `field`:
 *
 *   { field: "score", gte: 0.8 }
 *   { field: "type",  oneOf: ["DOMAIN", "REGION"] }
 *   { field: "score", range: [0.5, 0.9] }
 *   { field: "start", valid: true }             // excludes null / NaN
 *
 * The expression-string form of `filter` accepts any Vega-compatible
 * predicate, e.g. `"datum.score > 0.8 && datum.type == 'DOMAIN'"`.
 */
interface FieldPredicate {
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

/**
 * Rendering options that control the visual presentation of a track.
 * These map directly to Nightingale component HTML attributes.
 * Track-level values override category-level values.
 */
interface RenderingOptions {
  /** CSS colour string for feature glyphs. */
  color?: string;

  /** Shape of feature glyphs (e.g. "rectangle", "circle", "diamond"). */
  shape?: string;

  /** Height of the track in pixels. */
  height?: number;

  /** Layout mode. Defaults to "non-overlapping". */
  layout?: "non-overlapping" | "default";

  /**
   * Continuous colour scale for colored-sequence and heatmap tracks.
   *
   * Maps numeric values to colours via a gradient with named stops.
   * Each stop has a `value` (the numeric threshold), a `color`, and an
   * optional human-readable `label`.
   *
   * At render time the pipeline is:
   *   sequence character → adapter-assigned numeric value → interpolated colour
   *
   * The adapter is responsible for producing numeric values (or encoded
   * characters that the Nightingale component decodes internally).
   * The config author only needs to define "what colours correspond to
   * what values" — the character↔number encoding is an implementation
   * detail hidden inside the adapter.
   *
   * If omitted, the Nightingale component's built-in default is used.
   *
   * Example — AlphaFold confidence:
   *   stops: [
   *     { value: 0,   color: "#ff7d45", label: "Very low" },
   *     { value: 50,  color: "#ffdb13", label: "Low" },
   *     { value: 70,  color: "#65cbf3", label: "Confident" },
   *     { value: 90,  color: "#0053d6", label: "Very high" }
   *   ]
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
 * - `"alphafold-ramp"` — pLDDT confidence ramp (very low → very high)
 * - `"alphamissense-ramp"` — pathogenicity ramp (benign → pathogenic)
 *
 * Custom themes can be registered at runtime via `registerTheme()`.
 *
 * Examples:
 *
 *   // Preferred — named theme, accessibility-reviewed
 *   { theme: "alphafold-ramp" }
 *
 *   // Escape hatch — explicit stops with hex codes
 *   { stops: [{ value: 0, color: "#000" }, { value: 100, color: "#fff" }] }
 */
interface ColorScaleConfig {
  /** Named theme (see list above). Preferred. */
  theme?: string;

  /** Explicit colour stops. Use only when no theme matches your data. */
  stops?: ColorStop[];
}

interface ColorStop {
  /** The numeric threshold for this stop. */
  value: number;

  /** CSS colour at this threshold (hex, rgb, or named colour). */
  color: string;

  /**
   * Optional human-readable label for this stop (e.g. "Very high",
   * "Pathogenic"). Used in legends and tooltips. Not required.
   */
  label?: string;
}

/**
 * Semantic track kind vocabulary.
 *
 * Describes biological data kinds rather than rendering components.
 * Each semantic kind resolves to a concrete (component, adapter)
 * pair and may carry a default rendering preset.
 *
 * This is the primary vocabulary for config authors.  The list is
 * stable and grows by addition — existing semantic kinds will not
 * be repointed to different renderers without a major version bump.
 */
type SemanticKind =
  /** Generic UniProt-style features. Combine with `filter` to subset by type. */
  | "features"
  /** InterPro domain hits (representative). */
  | "features-interpro"
  /** Natural or disease-associated variants with detail panel. */
  | "variants"
  /** Per-position variant count (line graph). */
  | "variant-counts"
  /** RNA editing events rendered as variants. */
  | "rna-editing"
  /** Per-position RNA editing count (line graph). */
  | "rna-editing-counts"
  /** Proteomics peptide evidence. */
  | "peptides"
  /** PTM-containing peptides (large-scale MS). */
  | "peptides-ptm"
  /** PDB structure coverage intervals. */
  | "structure-coverage"
  /** AlphaFold per-residue confidence (pLDDT). Includes default colour ramp. */
  | "confidence-score"
  /** AlphaMissense per-residue pathogenicity. Includes default colour ramp. */
  | "pathogenicity-score"
  /** AlphaMissense per-position × amino-acid heatmap. */
  | "pathogenicity-heatmap";

/**
 * Low-level Nightingale component names.
 * Authors should prefer `SemanticKind` above; use `component` only
 * as an escape hatch when no semantic kind matches.
 *
 * Typed as an open string so that components registered at runtime
 * (via `registerSemanticKind()` or `registerAdapter()`) are also
 * valid here. The `(string & {})` suffix preserves IntelliSense
 * for built-ins in TypeScript without narrowing the type.
 */
type KnownComponentName =
  | "nightingale-track-canvas"
  | "nightingale-interpro-track"
  | "nightingale-colored-sequence"
  | "nightingale-variation"
  | "nightingale-linegraph-track"
  | "nightingale-sequence-heatmap";

type ComponentName = KnownComponentName | (string & {});

/**
 * Named data adapters.
 *
 * Naming convention: `<source>-<format>`.  This makes each
 * adapter's coupling explicit — reading the list, an author can
 * tell whether an adapter is tied to a specific API (UniProt,
 * AlphaFold, InterPro) or parses a generic format (JSON array,
 * CSV, BED).
 *
 * Most authors never name an adapter directly — the semantic
 * `kind` field resolves to one automatically.  Adapters are
 * visible only when overriding the default or registering a
 * custom one at runtime.
 */
type KnownAdapterName =
  // ── Source-specific (coupled to a particular API output) ──
  | "uniprot-features-json"
  | "uniprot-variation-json"
  | "uniprot-variation-counts-json"
  | "uniprot-proteomics-json"
  | "uniprot-proteomics-ptm-json"
  | "uniprot-rna-editing-json"
  | "uniprot-rna-editing-counts-json"
  | "uniprot-proteins-pdb-json"
  | "interpro-entries-json"
  | "alphafold-prediction-json"
  | "alphamissense-average-csv"
  | "alphamissense-full-csv"
  // ── Generic format adapters (bring your own data) ─────────
  | "features-json"    // array of feature objects already in expected shape
  | "features-csv"     // CSV with columns: type,start,end,description[,score]
  | "features-tsv"     // TSV (tab-separated) with the same columns as features-csv
  | "bed";             // standard BED (tab-separated)

/** Open string — adapters registered via `registerAdapter()` are also valid. */
type AdapterName = KnownAdapterName | (string & {});
```

### Escape-Hatch API (Programmatic — 20% advanced use cases)

```typescript
/**
 * Runtime API for advanced customisation.
 * Accessed via the <protvista-uniprot> element's JS API.
 */
interface ProtvistaRuntimeAPI {
  /**
   * Register a custom adapter so it can be referenced by name in config.
   * @param name - A unique adapter name (must not collide with built-ins).
   * @param fn   - A function: (...rawResponses: any[]) => TrackData.
   */
  registerAdapter(name: string, fn: AdapterFunction): void;

  /**
   * Register a custom semantic kind so community-defined data types
   * can be authored with the same ergonomic `kind:` surface as
   * built-ins, rather than falling back to explicit `component` +
   * `adapter` pairs.
   *
   * Example:
   *   api.registerSemanticKind("crispr-guides", {
   *     component: "nightingale-track-canvas",
   *     adapter:   "my-crispr-json",
   *     rendering: { shape: "diamond", color: "#8e44ad" },
   *   });
   *
   *   // then in config:
   *   - kind: crispr-guides
   *     data: guides
   *
   * @param name - Unique kind name (must not collide with built-ins).
   * @param def  - The component/adapter pair and optional default rendering.
   */
  registerSemanticKind(name: string, def: SemanticKindDefinition): void;

  /**
   * Register a custom transform operator so it can appear as a step
   * in `DataSourceDescriptor.transform`. The operator name becomes
   * the discriminator key in the transform step object.
   *
   * Example:
   *   api.registerTransform("aggregateBy", (items, params) => { ... });
   *
   *   # in config:
   *   transform:
   *     - aggregateBy: { field: type, op: count }
   */
  registerTransform(name: string, fn: TransformFunction): void;

  /**
   * Register a custom colour-scale theme (see `ColorScaleConfig.theme`).
   */
  registerTheme(name: string, stops: ColorStop[]): void;

  /**
   * Provide data directly for a specific track, bypassing URL fetching.
   * Used with DataSourceDescriptor.from = "custom".
   * @param categoryId - The category's `id`.
   * @param trackId    - The track's `id`.
   * @param data       - Data conforming to the track's expected Representation.
   *                     Must be an array or a plain object; primitives
   *                     (null, undefined, strings, numbers) are rejected
   *                     with a console.warn and the call is ignored.
   */
  setTrackData(categoryId: string, trackId: string, data: unknown): void;

  /**
   * Configuration input — three ways to mount a viewer config.
   * Precedence (highest first):
   *   1. `viewerConfig` property — pass a parsed ProtvistaViewerConfig object
   *   2. `config-src` attribute — URL or file path to a YAML/JSON config
   *   3. Built-in bundled default config
   * 
   * When `viewerConfig` is set, `config-src` and the default are ignored.
   * When only `config-src` is set, it is fetched and parsed.
   * If neither is set, the bundled default applies.
   */
  viewerConfig?: ProtvistaViewerConfig | string; // property access
  // Also available as HTML attribute: <protvista-uniprot config-src="./config.yaml">

  /**
   * Opt-out for per-datapoint tooltips. When present as an HTML
   * attribute (e.g. `<protvista-uniprot notooltip>`), the popover
   * display is disabled while the rest of the viewer functions normally.
   * Useful for embedded contexts where popover positioning or stacking
   * is problematic.
   */
  notooltip?: boolean; // HTML attribute only: <protvista-uniprot notooltip>

  /**
   * Programmatic tooltip overrides keyed by semantic kind.
   * Values are TooltipSpec objects, including the `kind: "custom"`
   * form that accepts a render function (not representable in YAML).
   * Overrides the built-in defaults and any config-level `dataTooltip`
   * for the matching kind. Useful for integrators who need rich
   * interactive rendering or access to external data sources.
   *
   * Example:
   *   element.tooltips = {
   *     "evidence": {
   *       kind: "custom",
   *       render: (item) => `<strong>${item.accession}</strong>`
   *     }
   *   };
   */
  tooltips?: Record<string, TooltipSpec>;

  /**
   * Replace the entire viewer configuration at runtime.
   * Triggers a full re-render.
   */
  setConfig(config: ProtvistaViewerConfig): void;

  /**
   * Subscribe to viewer events (selection, zoom, data-loaded).
   */
  on(event: string, callback: (detail: unknown) => void): void;
}

interface SemanticKindDefinition {
  component: ComponentName;
  adapter: AdapterName;
  rendering?: RenderingOptions;
}

type AdapterFunction   = (...rawResponses: any[]) => unknown | Promise<unknown>;
type TransformFunction = (items: unknown[], params: unknown) => unknown[] | Promise<unknown[]>;
```

## Relationship to 3D viewers (MolStar & SVS)

Deep integration with structural viewers like MolStar, and with the emerging [SeqViewSpec (SVS)](https://molstar.org/mol-view-spec) standard being drafted by the Mol\* team, is an explicit non-goal for this grant. Following discussion with the Mol\*/SVS developers, ProtVista will not reshape its configuration schema, event model, or runtime around SVS at this time. SVS is a moving upstream specification, and committing to a preemptive shape during the grant would risk churn with no proportionate user benefit. Broader cross-viewer alignment remains a worthwhile long-term goal and will be revisited post-grant, on whatever the then-current SVS draft recommends.

Within the grant, ProtVista is free to cherry-pick individual concepts from SVS where they serve the low-friction-authoring goal on their own merits — independent of any eventual full-protocol adoption. The semantic `kind` field in this spec is one such borrowed idea: it gives config authors a stable, domain-level vocabulary (`"variants"`, `"confidence-score"`, and so on) that survives renderer changes, which is valuable whether or not SVS ever ships. Further individual SVS concepts will be evaluated case by case against the same criterion: does this make ProtVista easier for a bench scientist to use today?

The existing `nightingale-structure` component continues to provide 1D↔3D coordination via its internal SIFTS path, unchanged by this spec.

## Starter Kit

The Starter Kit is the primary vehicle for ProtVista's low-friction-authoring promise. It exercises the configuration schema for bring-your-own-data use cases and is shipped alongside the schema itself — its only dependency is on P1 (the config schema). The kit has three parts:

**S1 — Sample YAML config.** A heavily commented YAML file demonstrating all schema features: semantic kinds, inline data, CSV/TSV/BED adapters, `dataTooltip` templates, colour themes. Ships alongside the published JSON Schema so that a new adopter can read one file and understand the full vocabulary.

**S2 — Standalone HTML page.** A single `index.html` that loads ProtVista from CDN, reads a local config file, and mounts the viewer. Demonstrates the "no JavaScript required" workflow for external labs. The target audience is bench scientists and clinical researchers who can edit YAML but should not need to write code.

**S3 — Local data folder.** Sample CSV, TSV, BED, and JSON files showing the bring-your-own-data path. Each file includes comments explaining the expected column conventions and maps to one of the generic format adapters (`features-json`, `features-csv`, `features-tsv`, `bed`).

The three parts together lower the adoption barrier from "write JavaScript and understand Nightingale's component API" to "provide data in a supported format and edit a YAML config."

**Distribution.** The Starter Kit ships inside the ProtVista repository at `examples/starter-kit/`. Shipping in-repo (rather than as a separate npm package or GitHub Pages site) keeps the kit versioned alongside the schema it exercises and means a new adopter has a one-stop source that never drifts out of sync with the viewer they're loading. The CDN-based `index.html` in S2 pins to the same tag as the kit it lives under, and the `@ebi/uniprot-default` preset referenced by `extends:` is published from the same repo.

**Note on the playground.** The interactive web playground (a separate OMP output for edit-and-preview authoring) is a distinct artefact from the Starter Kit: the playground is a hosted editor, whereas the Starter Kit is a forkable, offline-capable file bundle. The playground builds on top of P1 (for validation) and S1 (as its seed config) but does not substitute for the kit's "clone, edit, host locally" path.

## Serialisation Formats

The schema is format-agnostic at the semantic level — a config is a plain JavaScript object regardless of how it's serialised. Two formats are supported:

- **YAML** is the recommended authoring format, especially for the Starter Kit audience. It supports comments, unquoted keys, and block scalars (`|`) for multiline Markdown `dataTooltip` templates. Starter Kit sample configs ship as `.yaml` files.
- **JSON** is the canonical wire format. The published JSON Schema validates both forms equally — YAML is parsed to a plain object, then validated against the same schema. JSON configs remain fully supported for tooling, programmatic generation, and environments without YAML.

All examples in this spec are shown in YAML form first with the JSON equivalent below. Pick whichever format suits your workflow; the resulting viewer behaviour is identical.

## Accessibility

Accessibility is a grant-level commitment (see the OMP) and is baked into the schema's built-in vocabulary rather than left to individual config authors:

- **Colour-blind-safe defaults.** The built-in colour themes referenced from `colorScale.theme` — `alphafold-ramp` (pLDDT confidence) and `alphamissense-ramp` (pathogenicity) — are published as accessibility-reviewed palettes. Authors who rely on semantic kinds (`confidence-score`, `pathogenicity-score`) or name a built-in theme get WCAG-compliant colouring for free. Explicit `stops:` escape-hatch gradients remain authorable, but shift the accessibility responsibility to the author and should be used only when no built-in theme fits.
- **Keyboard-accessible legends.** Colour-scale legends rendered from `ColorScaleConfig` are keyboard-focusable and announce their `label` via `aria-label`. The `label` field on `ColorStop` is the accessible name — authors who register custom themes via `registerTheme()` should supply labels for every stop, not only for legend clarity but for screen-reader output.
- **Tooltip semantics.** Track- and category-level `description` fields render as plain-text native HTML `title` attributes — no Markdown, no HTML — so screen readers pick them up via the browser's default a11y path. Per-datapoint `dataTooltip` content flows through `@markdoc/markdoc` to produce HTML preserving the Markdown's semantic structure (headings, emphasis, lists) rather than flattening to a styled `<div>`. Field interpolations are HTML-escaped at the boundary so those semantic tags stay intact for screen readers. Per-datapoint tooltips are displayed as click-triggered popovers (not hover-triggered) with `role="tooltip"` and `tabindex="-1"`. Focus moves into the popover on open and is restored to the previously-focused element on close (Escape key, outside click, or scroll). The popover is dismissed by Escape, outside-click, or any document scroll.
- **Library defaults are minimal.** The built-in `tooltipDefaults` registry ships a small `{ kind: "fields", fields: [...] }` spec per `SemanticKind` that emits a plain `<h5>Label</h5><p>value</p>` stream. Product-specific rich rendering (evidence icons, xref badges, taxonomy lookups) lives in consumer code via the `element.tooltipOverrides[kind]` escape hatch, not in the library.
- **Sensible out-of-the-box fallback.** When a track has no `kind`, no `dataTooltip`, and no `tooltipOverrides` entry, the resolver synthesizes a `fields` spec from the common feature-shaped record (`type`, `description`, `start | begin`, `end`). Missing fields drop out; an item carrying none of them stays empty. Any `tooltipContent` an adapter already stashed on the item is preserved — the fallback never stomps.
- **No colour-only encoding.** `RenderingOptions.shape` exists partly so tracks can encode distinctions redundantly (e.g. shape *and* colour) rather than colour alone. Config authors building custom tracks are encouraged to use shape or label text as a secondary channel alongside colour.

## Security and trust model

The viewer runs in the embedder's browsing context and inherits the embedder's CSP and same-origin policy. The schema does not introduce new privilege — it only declaratively names the network destinations the viewer will fetch.

- **`from: url` fetches** honour the browser's CORS rules: a `sources` entry pointing at a different origin works only if that origin sets appropriate CORS headers. The viewer never attempts to proxy, cache, or bypass this.
- **`from: file` fetches** resolve to `fetch()` against the same origin as the hosting page — they are not filesystem reads in the Node sense. For the Starter Kit, this means the HTML page and its sibling data files must be served from the same origin (e.g. a local web server, or a file hosted on a static site); opening `index.html` directly via `file://` will fail same-origin checks on most browsers.
- **`from: inline` data** never triggers a fetch and is the most trustworthy form for Starter Kit / offline use.
- **`from: custom` data** is injected by the embedder via `setTrackData()`; the trust posture is whatever the embedder applies to its own data.
- **`extends` resolution** can transitively introduce fetches at config-load time — an adopter who writes `extends: "@ebi/uniprot-default"` is trusting the contents of that preset to name only acceptable `sources` URLs. The preset registry is owned by the ProtVista project and its `@ebi/…` namespace is part of the trust boundary; arbitrary third-party preset URLs should be audited by the adopter before use.
- **Tooltip HTML** flows through Markdoc's own safe renderer — the document never reaches a raw `innerHTML` seam. User-interpolated data in `{% $field %}` placeholders is HTML-escaped before entering the Markdoc pipeline, so a malicious adapter payload cannot smuggle `<script>` into a tooltip. Authors registering custom adapters via `registerAdapter()` should nevertheless treat adapter output as the same trust level as the upstream data source. The `custom` branch of `dataTooltip` (the author-supplied render function) is out of this trust envelope by design — output is passed through verbatim, and authors who opt into `custom` take responsibility for their own escaping.

## Behavior

### Example 1: Minimal config — single category with one URL-sourced track

**Input (YAML — recommended for authors):**
```yaml
accession: P05067            # self-contained; HTML attribute overrides if present

sources:
  features: https://www.ebi.ac.uk/proteins/api/features/{accession}

categories:
  - id: DOMAINS              # label defaults to "Domains"
    tracks:
      - id: domain
        kind: features
        filter: DOMAIN        # shortcut: keep only items where type == DOMAIN
        data: features        # string shorthand — resolves via `sources`
        description: Specific combination of secondary structures organized into a characteristic 3D fold
```

**Input (JSON — canonical wire format):**
```json
{
  "accession": "P05067",
  "sources": {
    "features": "https://www.ebi.ac.uk/proteins/api/features/{accession}"
  },
  "categories": [
    {
      "id": "DOMAINS",
      "tracks": [
        {
          "id": "domain",
          "kind": "features",
          "filter": "DOMAIN",
          "data": "features",
          "description": "Specific combination of secondary structures organized into a characteristic 3D fold"
        }
      ]
    }
  ]
}
```

**Expected output (viewer behaviour):**

The viewer renders a single collapsible category "Domains" (label title-cased from the id) containing one track "Domain". The semantic `kind: "features"` resolves to the `nightingale-track-canvas` component plus the UniProt feature adapter — the author never had to name either. At mount time, the loader resolves the accession (attribute wins, then config), looks up `"features"` in `sources`, substitutes the resolved accession, fetches the response, runs it through the resolved adapter, filters to items where `type === "DOMAIN"`, and feeds the result to the canvas component. No `version`, no `data: []` wrapper, no explicit `from:`, no `label:` — beginner configs collapse to the minimum.

### Example 2: Inline data (Starter Kit use case, no server)

**Input:**
```yaml
categories:
  - id: MY_ANNOTATIONS
    label: My custom annotations
    tracks:
      - id: binding_sites
        label: Predicted binding sites
        kind: features
        data:
          from: inline
          inlineData:
            - { type: BINDING, start: 45,  end: 52,  description: ATP binding }
            - { type: BINDING, start: 120, end: 128, description: Mg2+ binding }
        description: Binding sites predicted by my pipeline
        rendering:
          color:  "#e74c3c"
          shape:  diamond
```

**Expected output (viewer behaviour):**

The viewer renders a "My custom annotations" category with a "Predicted binding sites" track. No HTTP requests are made; the two features from `inlineData` are rendered directly as red diamonds on the canvas track. `data` is accepted as a single object (no `[ ... ]` wrapper needed) and `from: inline` explicitly signals that no network fetch should happen.

### Example 3: Full UniProt-equivalent config (excerpt showing inheritance, multi-URL adapter, filter UI)

**Input:**
```yaml
defaults:
  labelUrl: "https://www.uniprot.org/uniprot/{accession}"     # every track inherits this

sources:
  features:            https://www.ebi.ac.uk/proteins/api/features/{accession}
  variation:           https://www.ebi.ac.uk/proteins/api/variation/{accession}
  proteins:            https://www.ebi.ac.uk/proteins/api/proteins/{accession}
  alphafoldPrediction: https://alphafold.ebi.ac.uk/api/prediction/{accession}

categories:
  - id: ALPHAFOLD_CONFIDENCE
    label: AlphaFold
    helpPage: structure_section#alphafold-structural-models
    tracks:
      - id: alphafold_confidence
        label: AlphaFold Confidence
        labelUrl: https://alphafold.ebi.ac.uk/entry/{accession}     # overrides defaults.labelUrl
        kind: confidence-score
        data:
          source: [alphafoldPrediction, proteins]                   # two-URL adapter
        description: AlphaFold prediction confidence
        dataTooltip: |
          ### AlphaFold Confidence

          **pLDDT:** `{% $score %}`

          Scores above `90` indicate high expected accuracy.

  - id: VARIATION
    label: Variants
    helpPage: variant_viewer
    tracks:
      - id: variation_graph
        label: Counts
        kind: variant-counts
        data: variation
        description: Variant counts per position

      - id: variation
        kind: variants
        filterUI: nightingale-filter          # attaches the variant filter widget
        data: variation
        description: Natural variants including polymorphisms and disease-associated mutations
```

**Expected output (viewer behaviour):**

The AlphaFold category has no `rendering` block because `kind: "confidence-score"` carries the AlphaFold colour ramp as a default preset — authors get the canonical appearance for free. The adapter (resolved from the semantic kind) receives two raw responses (from `alphafoldPrediction` and `proteins`) and produces a coloured-sequence string. The Variation category is similarly terse: `data: variation` is string shorthand that resolves via `sources`; `filterUI: nightingale-filter` attaches the variant filter widget. Every track inherits `defaults.labelUrl` unless it overrides (the AlphaFold track points at alphafold.ebi.ac.uk). Authors only write domain language (`"variants"`, `"confidence-score"`) — never Nightingale component names or adapter names.

### Example 4: Bring-your-own CSV with a Vega-Lite transform pipeline

**Input (YAML):**
```yaml
categories:
  - id: MY_LAB
    label: Lab predictions
    tracks:

      # Features parsed from a local CSV file, then filtered and reshaped
      # declaratively — no JavaScript.  The Vega-Lite transform vocabulary
      # (https://vega.github.io/vega-lite/docs/transform.html) is reused
      # so authors familiar with Altair / Observable Plot feel at home.
      - id: hotspots
        label: High-confidence hotspots
        kind: features
        data:
          url: ./my-hotspots.csv          # from + adapter inferred from .csv
          transform:
            - filter: { field: score,      gte: 0.8 }
            - filter: { field: hotspot_type, oneOf: [binding, catalytic] }
            - rename: { desc: description, pos_start: start, pos_end: end }
            - calculate: "datum.end - datum.start"
              as: length
            - limit: 500
        dataTooltip: |
          ### {% $description %}
          **Score:** `{% $score %}` — length {% $length %}
          Residues **{% $start %}–{% $end %}**

      # Custom per-residue score rendered with the canonical AlphaFold
      # gradient — theme reused, no hex codes.
      - id: custom_score
        label: My score
        component: nightingale-colored-sequence
        data:
          from: inline
          inlineData: [0.1, 0.3, 0.4, 0.8, 0.95]
          adapter: features-json
        rendering:
          colorScale:
            theme: alphafold-ramp
```

**Expected output (viewer behaviour):**

No HTTP requests are made. The `features-csv` adapter parses `./my-hotspots.csv` into raw feature objects. The Vega-Lite `transform` pipeline then runs in order: keep only items where `score >= 0.8`, keep only the two listed hotspot types, rename three fields, compute a derived `length` field, and cap the result at 500 items. The author's `dataTooltip` template can reference both original and derived fields (`{length}` was calculated inline). The second track reuses the canonical AlphaFold colour ramp by name. This is the target workflow for Starter Kit adopters: YAML, local data, no JavaScript — and arbitrary data-shaping expressible declaratively.

### Example 5: Extending the EBI default — one line, one new track

**Input (YAML):**
```yaml
# An external lab's config: inherit the published EBI UniProt config,
# then add one custom track in a new category. Nothing else needs to
# be restated — `sources`, `defaults`, all 15 EBI categories, every
# built-in colour theme: all pulled in from the base.
extends: "@ebi/uniprot-default"

categories:
  - id: MY_LAB
    label: My lab
    tracks:
      - id: hotspots
        kind: features
        data: ./hotspots.csv
```

**Expected output (viewer behaviour):**

At load time the resolver fetches `@ebi/uniprot-default` (a registered preset name that points at the EBI-published config), merges its `sources`, `defaults`, and 15 categories underneath this config, then appends the `MY_LAB` category at the end of the category list. The user sees the full canonical UniProt viewer with their one extra track tacked on — authored in a handful of lines of YAML. Overriding a specific EBI track is equally cheap: declare a category with the same `id` as one in the base and the merge rules fold it in field-wise.

## Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| A `url` data source returns HTTP 4xx/5xx | The track is silently hidden (consistent with current behaviour). A `console.warn` is emitted. The rest of the viewer renders normally. The category is hidden if *all* its tracks have no data. |
| A `source` (or bare `url`) value is not a URL, not a file path, and does not match any key in `sources` | Config validation fails at load time: `"Unknown source key: '<value>' in track <categoryId>/<trackId>. Known sources: ..."`. Viewer does not mount. |
| `data` string shorthand has an extension the resolver does not recognise (e.g. `./x.gff`) | Config validation fails: `"Cannot infer adapter for './x.gff' in track <categoryId>/<trackId>. Use an object form with explicit `adapter:` or register a handler for '.gff'."`. |
| `adapter` name does not match any built-in or registered adapter | Config validation fails: `"Unknown adapter: <name> in track <categoryId>/<trackId>. Did you forget to call registerAdapter()?"`. |
| `kind` (semantic) value is not in the semantic-kind vocabulary and is not registered | Config validation fails: `"Unknown semantic kind: '<value>' in track <categoryId>/<trackId>. Valid values: .... Register custom kinds with registerSemanticKind()."`. |
| A track has no `kind`, no `component`, and the parent category has no `component` | Config validation fails: `"Track <categoryId>/<trackId> has no 'kind' or 'component'. Set a semantic 'kind' (e.g. 'features') or provide 'component' explicitly."`. |
| A `dataTooltip` template references a field that does not exist on the adapter's output | That placeholder renders as an empty string. After the first render pass, a single summary `console.warn` lists all missing fields for that track. The viewer does not fail. |
| A `dataTooltip` template contains `<script>` or other dangerous HTML | For `kind: fields` and `kind: markdown`: all interpolated data from `{% $field %}` placeholders is HTML-escaped before rendering. Scripts and other raw markup are dropped. URL scheme whitelist: only `http:`, `https:`, and `mailto:` are allowed in anchor `href=` attributes; other schemes (e.g. `javascript:`) collapse to empty `href=""`. For `kind: custom`: the render function is a documented escape-hatch surface — the integrator is responsible for producing safe HTML. |
| `colorScale.theme` references a name that is not built-in or registered | Config validation fails: `"Unknown colorScale theme: '<name>'. Registered themes: ..."`. |
| `colorScale` has neither `theme` nor `stops` | Config validation fails: `"colorScale must specify either 'theme' or 'stops' ..."`. |
| A generic format adapter (e.g. `features-csv`) receives malformed input | The adapter throws a descriptive error identifying the row/column at fault. The track fails to load, but other tracks continue. |
| A `transform` step has no recognised operation key (`filter`, `calculate`, `rename`, `pick`, `limit`, or a registered custom operator) | Config validation fails: `"Unknown transform operator in track <categoryId>/<trackId>. Valid operators: ...."`. |
| A `filter` step's field predicate has no comparison operator (only `field:`) | Config validation fails: `"Filter predicate on field '<name>' must include one of: equal, lt, lte, gt, gte, oneOf, range, valid."`. |
| A `calculate` step's expression fails to parse or evaluate | The step is skipped for items where it throws; the `as` field is set to `null` on those items. A single summary `console.warn` is emitted per track. |
| `version` is explicitly set to an unsupported value | Validation fails: `"Unsupported config version: '<value>'. Supported: '1.0'."`. Omitting `version` is allowed (defaults to "1.0"). |
| A category has zero tracks | Validation warning emitted; category is skipped (not rendered). |
| `from: inline` with `inlineData` missing or null | Validation fails: `"inlineData is required when 'from' is 'inline' in track <categoryId>/<trackId>."`. |
| `from: custom` but `setTrackData()` never called at runtime | Track renders as empty/hidden. A `console.info` is emitted after initial load: `"Track <categoryId>/<trackId> is 'from: custom' but no data was provided via setTrackData()."`. |
| `extends` target cannot be fetched (404 / file missing / unknown preset name) | Validation fails: `"Cannot resolve extends: '<value>'. ..."`. Viewer does not mount. |
| `extends` chain contains a cycle | Validation fails: `"Circular extends: <a> → <b> → <a>"`. Viewer does not mount. |
| `extends` target is fetched but fails to parse (malformed JSON/YAML) | Validation fails: `"Failed to parse extends target '<name>': <parse error detail>"`. The target name (preset or URL) is included so the author can identify which file in a multi-level chain is broken. Viewer does not mount. |
| `extends` target exceeds 2 MiB when fetched | Validation fails with a size-exceeded error. The default fetcher checks both the HTTP `Content-Length` header and the final decoded response length to prevent DoS from attacker-controlled servers. Adopters can supply a custom `opts.fetcher` with their own size policy. |
| Duplicate `id` values within a category's tracks (after merge) | Validation fails: `"Duplicate track id '<id>' in category '<categoryId>'."`. |
| Duplicate category `id` values (after merge) | Validation fails: `"Duplicate category id '<id>'."`. |
| `filter` shortcut is specified but adapter returns no items matching that type | Track is hidden. Category is hidden if all sibling tracks are also empty. |
| Config JSON is syntactically invalid | Standard JSON parse error surfaced to the consumer. |
| Config contains `{accession}` placeholders but no accession was provided via attribute or config | Validation fails: `"Config contains {accession} placeholders but no accession was provided via attribute or config."` |
| Both the HTML attribute and the config file specify `accession` | The HTML attribute wins. No warning — this is the expected reuse pattern (one config, many entries). |

## Design Invariants

These hold across the configuration schema and the Starter Kit:

**Additive only.** Every change to the schema is a new optional property. Nothing is removed from an existing API. A ProtVista config that worked before any later enhancement (including any future SVS-flavoured work) must continue to work identically after.

**Low-friction authoring is the dominant constraint.** If a proposed change makes the typical user config shorter, clearer, or more copy-paste-able for a bench scientist with no JavaScript, it wins. If it only makes life easier for framework-level integrators at the cost of config authors, it needs a strong reason.

**Config format is independent of any external protocol.** The schema is ProtVista's own shape, not a compiled form of SVS, MolViewSpec, or any other upstream specification. Where individual ideas from such protocols are borrowed (e.g. the `kind` discriminator), they are borrowed because they stand on their own merit inside this schema — not because of a commitment to a wider protocol.

**Defaults are canonical.** Built-in semantic kinds carry the canonical rendering defaults for their domain (AlphaFold confidence ramp, AlphaMissense pathogenicity ramp, etc.) so that authors get the "standard" appearance without writing any rendering block at all.

## Versioning

The schema follows semantic versioning at the protocol level (distinct from the library's own npm version). `version: "1.0"` is the first published protocol version; later versions will increment additively.

- **Additive-only evolution.** Every post-v1.0 addition is a new optional property, semantic kind, adapter name, or transform operator. Existing fields and their semantics are never repointed. A config authored against v1.0 validates and renders identically on every later compatible version.
- **Omitting `version` is valid** and is the recommended default for beginner configs — the loader assumes the latest supported protocol version. Authors who need to pin to a specific protocol version set `version` explicitly; this is only necessary when authoring against a historical schema revision.
- **Version discovery.** New features added post-v1.0 are documented in `examples/starter-kit/` (the sample config tracks the current schema) and in `specs/config-approach.md`'s changelog. Editor autocomplete against the published JSON Schema will surface any newly-added optional fields to authors without requiring them to opt into a specific version string.
- **Unknown-version rejection.** A `version` value that is not in the supported set fails validation with `"Unsupported config version: '<value>'. Supported: ..."`. The loader does **not** attempt to auto-migrate forward or backward — this keeps the validation surface deterministic and prevents silent behavioural drift. If a future breaking change is unavoidable, a new major-version loader will be shipped that can opt to accept legacy configs via an explicit migration step.

## Dependency Graph

The grant deliverable is P1 + the Starter Kit (S1–S3). Neither has any external cross-project dependency — no Nightingale SVS phase, no MolStar coordination work, no upstream protocol release. P1 can ship immediately; each Starter Kit part depends only on P1.

| Starter Kit phase | Depends on | Notes |
|---|---|---|
| S1 (sample YAML config) | P1 only | |
| S2 (standalone HTML page) | P1 only | |
| S3 (local data folder) | P1 only | |

## Open Questions

1. ~~**Generic format adapter coverage.**~~ **Resolved.** The CSV header row (`type,start,end,description[,score]`) is the minimal contract. TSV is a first-class sibling — `features-tsv` is shipped alongside `features-csv` with the same column convention, tab-separated. Optional extra columns are surfaced through `dataTooltip` templates on a per-track basis (not auto-surfaced — that would pollute the payload shape for tracks that don't use them).

2. ~~**Starter Kit distribution channel.**~~ **Resolved.** The Starter Kit ships inside the ProtVista repository at `examples/starter-kit/`; see the [Starter Kit](#starter-kit) section. The CDN-based `index.html` in S2 pins to the repo tag; `extends: "@ebi/uniprot-default"` resolves to the default config published from this same repo.

3. ~~**Transform-expression evaluator.**~~ **Resolved.** The Vega-Lite-style `filter: "<expr>"` and `calculate: "<expr>"` string forms are evaluated using Vega's safe expression parser (`vega-expression`). Larger dependency than an in-house minimal evaluator (~40 kB gzipped on top of the baseline runtime), but offers the widest compatibility — configs authored against Vega/Vega-Lite/Observable Plot "just work" without a separate expression dialect. Bundle-size implications are recorded in [Constraints](#constraints). The structured field-predicate form remains evaluator-free.

4. **Preset namespace.** What namespace do we use for shipped presets (`@ebi/uniprot-default`, possibly `@ebi/alphafold-overlay`, etc.)? If we adopt `@<org>/<name>`, how does the loader resolve it — npm-style, a published manifest, or a baked-in registry in the viewer? *Deferred.* Must be resolved before the `extends` merger (task #20) lands; the shipped `examples/starter-kit/` base config can use the eventual namespace at that point.

## Constraints

- **Stack/language:** TypeScript, targeting ES2020+. The schema is defined as a JSON Schema (draft 2020-12) published alongside TypeScript interfaces. Runtime validation uses a lightweight JSON Schema validator (e.g. Ajv).
- **Follow the pattern in:** `src/config.ts` (current hardcoded config — the new schema is a superset of its structure); `src/protvista-uniprot.ts` `_loadData()` (current loading logic — the new loader must support the same data flow).
- **Allowed dependencies:**
  - Ajv (JSON Schema validator, ~70 kB gzipped).
  - `js-yaml` (YAML parser, ~16 kB gzipped) — **lazy-loaded**, imported dynamically only when a YAML config is actually encountered, so JSON-only adopters pay nothing for it.
  - `@markdoc/markdoc` (declarative Markdown renderer with a tag/variable system, used by `dataTooltip`'s markdown form, ~30 kB gzipped). Markdoc's safe renderer is used end-to-end — field interpolations are HTML-escaped at the boundary rather than running a separate sanitiser pass. `description` (category- and track-level label hover text) does not go through Markdoc — it is rendered as a plain-text native HTML `title` attribute.
  - `@floating-ui/dom` (~4 kB gzipped) — positions the click-triggered tooltip popover. Middleware `flip` + `shift` keep the popover on-screen regardless of where on the track the user clicked, and `autoUpdate` keeps the position in sync while the popover is open. The popover itself (`src/tooltips/popover.ts`) is a single `<div role="tooltip">` appended to the host element's light DOM; its only external dependency is Floating UI. Click-only by design — hover events are deliberately ignored to avoid flicker on canvas tracks and the a11y complications of hover-triggered popovers.
  - `vega-expression` (Vega's safe expression parser, ~40 kB gzipped) — used for the string forms of `filter:` and `calculate:` transforms. The structured field-predicate form and the non-expression operators (`rename`, `pick`, `limit`) do not depend on this — it is lazy-loaded only when an expression string is encountered.
  - The JSON Schema file itself has zero dependencies.
- **Forbidden dependencies:** Full-featured form libraries, heavyweight schema tools (e.g. Zod at runtime — fine for dev tooling), anything requiring a build step to consume the schema.
- **Bundle-size target:** The *eagerly loaded* runtime additions introduced by P1 (validator + loader + normalize + merge; i.e. excluding the lazy-loaded YAML parser and Vega expression parser) must sit within ~130 kB gzipped. Adopters loading a JSON-only config with no expression-string transforms never pay for `js-yaml` or `vega-expression`. All four lazy-loaded deps combined must not exceed an additional ~70 kB gzipped when actually triggered.
- **Performance requirements:** Config validation must complete in <50 ms for a config with 15 categories and 60 tracks. URL deduplication must match the current behaviour — identical URLs referenced by multiple tracks are fetched exactly once (sources keys are resolved before deduplication). All fetches execute in parallel (current `fetchAll` pattern).

## Acceptance Criteria

- [x] A JSON Schema file (`protvista-config.schema.json`) is published that validates all examples in this spec.
- [x] The existing hardcoded `config.ts` default configuration can be losslessly represented as a YAML/JSON file conforming to the new schema (round-trip fidelity).
- [x] `version`, category `label`, and category `component` are all optional; a config that omits them validates and renders. Category `label` falls back to a title-cased `id`; category `component` is inferred from child tracks' `kind`s.
- [x] The four `data` forms all work: `data: "<sources-key>"`, `data: "./file.csv"` (and `.json`, `.bed`), `data: { ... }` (single object), `data: [ ... ]` (array for multi-URL adapters).
- [x] `data: "./x.csv"` infers `from: file, adapter: features-csv` automatically; likewise `.tsv → features-tsv`, `.json → features-json`, `.bed → bed`.
- [x] A config with `from: inline` data renders tracks without any HTTP requests.
- [x] A config with `from: url` using `source:` (or bare `url:`) sources-key resolution fetches correctly.
- [x] `from: custom` data sources are renderable via the `setTrackData()` escape-hatch API.
- [x] `registerAdapter()`, `registerSemanticKind()`, `registerTransform()`, and `registerTheme()` each allow a user-defined name to be referenced from config and function correctly.
- [x] Vega-Lite-style `transform` pipelines work for the built-in operators (`filter`, `calculate`, `rename`, `pick`, `limit`). Field predicates accept `equal`, `lt`, `lte`, `gt`, `gte`, `oneOf`, `range`, `valid`. Expression-string filters (`"datum.score > 0.8"`) work for the same cases.
- [x] Track-level `filter: "<value>"` shortcut produces the same output as the equivalent `transform: [{ filter: { field: "type", equal: "<value>" } }]` — parity test.
- [x] `extends` resolves one or more base configs, merges per the documented rules (sources by key, categories by id, rendering field-wise, child wins), and handles both file/URL and registered-preset targets. Cycles are detected and fail validation.
- [x] `defaults.rendering`, `defaults.labelUrl`, and `defaults.helpPage` inherit to every category/track and are overridden at the category and track level per the documented precedence chain.
- [x] Track rendering options (`color`, `shape`, `height`, `layout`, `colorScale`) correctly inherit from `defaults` → category → track, with track winning on conflict.
- [x] Config validation produces clear, actionable error messages for all edge cases listed above.
- [x] The schema is published with a `$schema` URI so that editors (VS Code, etc.) provide autocomplete and inline validation.
- [x] All 15 existing UniProt categories render correctly when driven by the new config format (parity test against the hardcoded `config.ts`).
- [x] Every track in the published default config uses the semantic `kind` field (no raw `component` + `adapter` pairs at the track level).
- [x] Semantic kinds `confidence-score` and `pathogenicity-score` apply the canonical AlphaFold / AlphaMissense colour ramps automatically when `rendering.colorScale` is not specified.
- [x] Explicit `component` on a track or `adapter` on a data source override the semantic-kind resolution.
- [x] `filterUI: "nightingale-filter"` attaches the variant filter widget.
- [x] `dataTooltip` accepts the three authoring forms — shorthand string, `kind: fields`, and `kind: markdown` — and renders correctly for each data point on the track. Markdown is rendered via `@markdoc/markdoc`; `{% $field %}` placeholders can reference fields produced by `calculate` transform steps and are HTML-escaped before substitution.
- [ ] Missing field references in `dataTooltip` render as empty strings and emit one summary warning per track, not per data point.
- [x] YAML configs load and validate equivalently to JSON configs. A round-trip (JSON → YAML → JSON) on the default config is lossless.
- [ ] The Starter Kit sample config ships in YAML with comments and multiline `dataTooltip` block scalars.
- [x] Adapter names follow the `<source>-<format>` convention. A config author can tell at a glance which adapters are EBI-specific and which parse generic formats.
- [ ] At least four generic format adapters ship with the viewer: `features-json`, `features-csv`, `features-tsv`, and `bed`. Each has a documented column/shape convention and unit tests covering happy-path and malformed inputs.
- [x] Built-in themes `alphafold-ramp` and `alphamissense-ramp` are defined once, used by default in `confidence-score` / `pathogenicity-score` semantic kinds, and available to any track via `colorScale.theme`.
- [ ] The Starter Kit example (local/inline data, no server) works end-to-end with the new schema.
- [ ] A non-developer adopter can clone the Starter Kit, point it at their own CSV/BED/JSON file, edit the YAML config, and see their data in the viewer without writing any JavaScript.
- [ ] An external-lab adopter can write a ten-line config using `extends: "@ebi/uniprot-default"` and add one extra track, with the full EBI viewer inherited intact.
- [x] `accession` can be supplied via config, HTML attribute, or `setConfig()`. The HTML attribute takes precedence over the config value. A config with `{accession}` placeholders but no accession from any source fails validation with a clear message.

## Tests

```typescript
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import schema from "../protvista-config.schema.json";
import defaultConfig from "../src/default-config.yaml"; // migrated from config.ts
import { normalize, mergeExtends, applyTransforms } from "../src/runtime";

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

describe("ProtVista Viewer Config Schema — JSON Schema layer", () => {
  it("accepts the migrated default UniProt config", () => {
    expect(validate(defaultConfig)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it("accepts a minimal config with no version, no label, no component", () => {
    const config = {
      categories: [
        {
          id: "DOMAINS",
          tracks: [{ id: "domain", kind: "features", filter: "DOMAIN", data: "features" }],
        },
      ],
      sources: { features: "https://example.com/features/{accession}" },
    };
    expect(validate(config)).toBe(true);
  });

  it("accepts all four shapes of the `data` field", () => {
    const shapes = [
      { data: "features" },                                       // sources-key shorthand
      { data: "./hits.csv" },                                     // file-path shorthand
      { data: { from: "inline", inlineData: [] } },               // single descriptor
      { data: [{ source: "a" }, { source: "b" }] },               // array
    ];
    for (const s of shapes) {
      const config = {
        categories: [{ id: "C", tracks: [{ id: "t", kind: "features", ...s }] }],
        sources: { features: "https://x/{accession}", a: "https://a", b: "https://b" },
      };
      expect(validate(config)).toBe(true);
    }
  });

  it("rejects inline data source with missing inlineData", () => {
    const config = {
      categories: [
        { id: "C", tracks: [{ id: "t", kind: "features", data: { from: "inline" } }] },
      ],
    };
    expect(validate(config)).toBe(false);
  });

  it("accepts a Vega-Lite-style transform pipeline", () => {
    const config = {
      categories: [
        {
          id: "C",
          tracks: [{
            id: "t",
            kind: "features",
            data: {
              url: "./hits.csv",
              transform: [
                { filter: { field: "score", gte: 0.8 } },
                { filter: { field: "type", oneOf: ["A", "B"] } },
                { rename: { desc: "description" } },
                { calculate: "datum.end - datum.start", as: "length" },
                { limit: 500 },
              ],
            },
          }],
        },
      ],
    };
    expect(validate(config)).toBe(true);
  });

  it("rejects a filter predicate with no comparison operator", () => {
    const config = {
      categories: [
        {
          id: "C",
          tracks: [{
            id: "t",
            kind: "features",
            data: { url: "./x.csv", transform: [{ filter: { field: "score" } }] },
          }],
        },
      ],
    };
    expect(validate(config)).toBe(false);
  });

  it("accepts top-level extends and defaults", () => {
    const config = {
      extends: "@ebi/uniprot-default",
      defaults: { rendering: { layout: "non-overlapping" }, labelUrl: "https://x/{id}" },
      categories: [{ id: "MY", tracks: [{ id: "t", kind: "features", data: "./x.csv" }] }],
    };
    expect(validate(config)).toBe(true);
  });
});

describe("ProtVista Viewer Config Schema — runtime layer", () => {
  it("title-cases category id when label is omitted", () => {
    const cfg = normalize({
      categories: [{ id: "MOLECULE_PROCESSING", tracks: [] }],
    });
    expect(cfg.categories[0].label).toBe("Molecule processing");
  });

  it("treats `filter: X` as sugar for transform filter by type == X", () => {
    const items = [
      { type: "DOMAIN", start: 1, end: 10 },
      { type: "SIGNAL", start: 11, end: 20 },
    ];
    const shortcut    = applyTransforms(items, [], { filter: "DOMAIN" });
    const equivalent  = applyTransforms(items,
      [{ filter: { field: "type", equal: "DOMAIN" } }],
      {});
    expect(shortcut).toEqual(equivalent);
    expect(shortcut).toHaveLength(1);
  });

  it("merges an extends chain per documented rules", async () => {
    const base = {
      sources: { features: "https://base/{accession}" },
      categories: [
        { id: "A", tracks: [{ id: "t1", kind: "features", data: "features" }] },
      ],
    };
    const child = {
      extends: "base",
      categories: [
        { id: "A", tracks: [{ id: "t2", kind: "features", data: "features" }] },
        { id: "B", tracks: [{ id: "t3", kind: "features", data: "features" }] },
      ],
    };
    const merged = await mergeExtends(child, { base });
    // Category A has both tracks; Category B is appended at the end
    expect(merged.categories.map((c) => c.id)).toEqual(["A", "B"]);
    expect(merged.categories[0].tracks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(merged.sources.features).toBe("https://base/{accession}");
  });

  it("rejects duplicate category ids within a single config", () => {
    expect(() => normalize({
      categories: [
        { id: "DUPED", tracks: [] },
        { id: "DUPED", tracks: [] },
      ],
    })).toThrow(/Duplicate category id 'DUPED'/);
  });

  it("detects circular extends chains", async () => {
    const a = { extends: "b", categories: [] };
    const b = { extends: "a", categories: [] };
    await expect(mergeExtends(a, { a, b })).rejects.toThrow(/Circular extends/);
  });

  it("deduplicates URLs across tracks sharing the same source key", () => {
    const config = normalize({
      sources: { features: "https://example.com/features/{accession}" },
      categories: [
        {
          id: "SITES",
          tracks: [
            { id: "metal",   kind: "features", filter: "METAL",   data: "features" },
            { id: "site",    kind: "features", filter: "SITE",    data: "features" },
            { id: "binding", kind: "features", filter: "BINDING", data: "features" },
          ],
        },
      ],
    });
    const urls = config.categories
      .flatMap((c) => c.tracks)
      .flatMap((t) => t.data)
      .flatMap((d: any) => (Array.isArray(d.url) ? d.url : [d.url]))
      .filter(Boolean);
    expect(new Set(urls).size).toBe(1);
  });
});
```

## Acknowledgement

This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI grant reference AH/Z000114/1.
