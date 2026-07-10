/**
 * Shared type definitions for the declarative tooltip system.
 *
 * Contract at a glance:
 *
 *   +--------+  adapter output
 *   | item   | ---> resolveTooltip(item, spec, ctx) ---> HTML string
 *   +--------+                                              |
 *                                                           v
 *                                          attached to item.tooltipContent
 *                                          by load-data.ts before the data
 *                                          is handed to Nightingale
 *
 * Existing non-empty `item.tooltipContent` wins before the resolver is
 * called. Otherwise `spec` is sourced in this order of precedence:
 *   1. track.dataTooltip       (YAML author override)
 *   2. tooltipDefaults[kind]   (per-kind built-in default)
 *   3. auto-fallback           (compact Markdoc from adapted fields)
 *
 * There is no programmatic per-kind override surface on the element.
 * Consumers who need rich / interactive / stateful tooltips listen for
 * the Nightingale `change` event and mount their own UI (set the
 * `notooltip` attribute on the element to suppress the library's
 * built-in popover). That split — declarative tooltips in library,
 * rich rendering in consumer — keeps the two concerns cleanly layered.
 */

/**
 * `TooltipSpec` is the discriminated union of authoring surfaces.
 *
 *   - `fields`   — curator / bioinformatician. Declarative, no syntax.
 *   - `markdown` — mixed author. Markdoc template.
 *
 * Both variants are expressible in YAML/JSON, so the runtime union and
 * the config-authored union are the same shape. `AuthoredTooltipSpec`
 * aliases `TooltipSpec` for readability at call sites that specifically
 * mean "what YAML accepts."
 */
export type TooltipSpec = FieldsSpec | MarkdownSpec;

/** Alias of `TooltipSpec` — identical shape; named separately for clarity at YAML-author-facing call sites. */
export type AuthoredTooltipSpec = TooltipSpec;

interface FieldsSpec {
  kind: 'fields';
  /** Ordered rows to render as a definition list. */
  fields: FieldSpec[];
}

interface MarkdownSpec {
  kind: 'markdown';
  /** Markdoc template source. `{% $variable %}` available for field interpolation. */
  template: string;
  /** Additional variables merged into the item as Markdoc `variables:`. */
  variables?: Record<string, unknown>;
}

/**
 * One row in a `fields`-form tooltip.
 *
 * `path` is dot-notation against the item. The value at that path is
 * coerced to a string and HTML-escaped at the leaf — no per-field
 * render hook. Rich, consumer-specific rendering goes through the
 * event-listener pattern (listen for the Nightingale `change` event,
 * mount your own UI, set the `notooltip` attribute on the element).
 */
export interface FieldSpec {
  path: string;
  label: string;
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
 * Map of kind name → default spec. `tooltipDefaults[kind]` is consulted when
 * no per-track override is supplied. Covers every built-in kind; downstream
 * tools can register their own.
 */
export type TooltipDefaultsRegistry = Record<string, TooltipSpec>;
