/**
 * Shared type definitions for the declarative tooltip system.
 *
 * Contract at a glance:
 *
 *   +--------+  adapter output (no tooltipContent)
 *   | item   | ---> resolveTooltip(item, spec, ctx) ---> HTML string
 *   +--------+                                              |
 *                                                           v
 *                                          attached to item.tooltipContent
 *                                          by load-data.ts before the data
 *                                          is handed to Nightingale
 *
 * `spec` is sourced in this order of precedence inside the resolver:
 *   1. element.tooltips[kind]              (programmatic escape hatch —
 *                                           JS `TooltipSpec` registry on
 *                                           the `<protvista-uniprot>`
 *                                           element; the only surface
 *                                           that accepts `kind: 'custom'`)
 *   2. track.dataTooltip                   (YAML author override)
 *   3. tooltipDefaults[kind]               (per-kind built-in default)
 *   4. () => ''                            (missing — e.g. graph tracks)
 */

/**
 * `TooltipSpec` is the discriminated union of authoring surfaces.
 *
 * The three variants intentionally correspond to the three personas called
 * out in the roadmap:
 *   - `fields`   — curator / bioinformatician. Declarative, no syntax.
 *   - `markdown` — mixed author. Markdoc template + typed tags.
 *   - `custom`   — integrator. Full programmatic control.
 */
export type TooltipSpec = FieldsSpec | MarkdownSpec | CustomSpec;

/**
 * The YAML/JSON-authorable subset of `TooltipSpec`. Excludes `CustomSpec`
 * because a `render` function has no representation in a declarative config
 * file — authors who need `custom` reach for the runtime `tooltipOverrides`
 * escape hatch on the `<protvista-uniprot>` element instead.
 *
 * This is the contract the `dataTooltip` field in the config schema accepts
 * (alongside its string shorthand, which normalises to `MarkdownSpec`).
 */
export type AuthoredTooltipSpec = FieldsSpec | MarkdownSpec;

export interface FieldsSpec {
  kind: 'fields';
  /** Ordered rows to render as a definition list. */
  fields: FieldSpec[];
}

export interface MarkdownSpec {
  kind: 'markdown';
  /** Markdoc template source. `{% $variable %}` and `{% tag /%}` available. */
  template: string;
  /** Additional variables merged into the item as Markdoc `variables:`. */
  variables?: Record<string, unknown>;
}

export interface CustomSpec {
  kind: 'custom';
  /** Pure function — produces the tooltip HTML for a single item. */
  render: (item: unknown, ctx: TooltipContext) => string;
}

/**
 * One row in a `fields`-form tooltip.
 *
 * `path` is dot-notation against the item. `render:` names a helper in the
 * `tooltipHelpers` registry; when omitted the value is coerced to a string
 * and HTML-escaped at the leaf.
 */
export interface FieldSpec {
  path: string;
  label: string;
  render?: string;
}

/**
 * Ambient context every resolver call receives. Populated by `load-data.ts`
 * once per track and reused across every item on that track.
 */
export interface TooltipContext {
  accession: string;
  trackId: string;
  kind: string;
}

/**
 * Signature for entries in the `tooltipHelpers` registry and the value-side
 * of `render:` hooks on `FieldSpec`. Helpers are pure — no DOM, no network.
 */
export type TooltipHelper = (value: unknown, ctx: TooltipContext) => string;

/**
 * The external-URL template registry. Values are strings containing exactly
 * one `{id}` placeholder; `expandLink(source, id)` substitutes and returns
 * the full URL. Embedders replace entries to point at internal mirrors.
 */
export type TooltipLinkRegistry = Record<string, string>;

/**
 * Map of kind name → default spec. `tooltipDefaults[kind]` is consulted when
 * no per-track override is supplied. Covers every built-in kind; downstream
 * tools can register their own.
 */
export type TooltipDefaultsRegistry = Record<string, TooltipSpec>;
