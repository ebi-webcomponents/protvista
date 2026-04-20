/**
 * Tooltip resolver — converts a `TooltipSpec` plus an item into an HTML
 * string that Nightingale will read off `feature.tooltipContent` on hover.
 *
 * Three branches:
 *
 *   - `kind: 'fields'`   — deterministic HTML synthesis from a field list.
 *                         Each `FieldSpec` becomes `<h5>label</h5>` followed
 *                         by a helper-rendered block or a plain `<p>`.
 *   - `kind: 'markdown'` — Markdoc parse → transform → render. The item is
 *                         flattened into the Markdoc variable scope so
 *                         authors reference fields as `{% $fieldName %}`.
 *                         Three typed tags are pre-registered (`xrefs`,
 *                         `evidence`, `link`) and delegate to the helper
 *                         and link registries.
 *   - `kind: 'custom'`   — verbatim call to the render function. The
 *                         programmatic escape hatch — no safety railings,
 *                         authors get full DOM access via their own Lit /
 *                         hand-rolled output.
 *
 * Markdoc's `renderers.html` HTML-escapes every string node (safe by
 * design), which means a helper that returns `<ul>…</ul>` would render
 * as `&lt;ul&gt;…`. To let helpers inject already-formatted HTML we use
 * a reserved marker tag `$raw-html` whose `html` attribute carries the
 * unescaped payload. The thin wrapper `renderNode` below recognises
 * that marker and returns its attribute verbatim; every other node
 * delegates to the stock Markdoc renderer. Only code in this module
 * and `tooltipHelpers` produces `$raw-html` nodes — template authors
 * cannot synthesise one from Markdoc source — so the tag can be trusted.
 */
import Markdoc, { Tag, type RenderableTreeNode } from '@markdoc/markdoc';
import type { TooltipContext, TooltipSpec, FieldSpec } from './types';
import { tooltipHelpers, formatXrefs, formatEvidence } from './helpers';
import { expandLink } from './links';

// -----------------------------------------------------------------------------
// Safe HTML escaping (for the `fields` branch fall-through)
// -----------------------------------------------------------------------------

/**
 * Escape the five characters that would otherwise let a field value
 * inject HTML structure. Matches the behaviour of
 * `MarkdownIt().utils.escapeHtml`, which Markdoc itself uses. Defined
 * locally so the `fields` branch doesn't have to instantiate a
 * `MarkdownIt` instance.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// -----------------------------------------------------------------------------
// Dot-path resolver
// -----------------------------------------------------------------------------

/**
 * Walk a dotted property path against an arbitrary value. Returns
 * `undefined` at the first missing segment, matching the "undefined
 * propagates" behaviour authors expect from JSX-style template
 * languages. Array indices (`items.0.id`) are supported.
 */
function resolvePath(item: unknown, path: string): unknown {
  if (!path) return item;
  let current: unknown = item;
  for (const segment of path.split('.')) {
    if (current == null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

// -----------------------------------------------------------------------------
// Raw-HTML carrier for Markdoc
// -----------------------------------------------------------------------------

/**
 * Reserved tag name that tells our renderer to emit its `html` attribute
 * verbatim. Using a `$`-prefixed name both avoids any collision with a
 * real HTML element and signals the "internal" status at call sites.
 */
const RAW_HTML_TAG = '$raw-html';

function rawHtml(html: string): Tag {
  return new Tag(RAW_HTML_TAG, { html }, []);
}

/**
 * Walk a Markdoc `RenderableTreeNode` and emit an HTML string. Delegates
 * to the stock Markdoc HTML renderer for every node except our
 * `$raw-html` marker, which emerges verbatim.
 */
function renderNode(node: RenderableTreeNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return Markdoc.renderers.html(node);
  }
  if (Array.isArray(node)) {
    return node.map(renderNode).join('');
  }
  if (node == null || typeof node !== 'object' || !Tag.isTag(node)) return '';
  if (node.name === RAW_HTML_TAG) {
    return String(node.attributes?.html ?? '');
  }
  // Delegate to the stock HTML renderer for standard tags, with our
  // own child walker handling any nested $raw-html markers.
  const { name, attributes, children = [] } = node;
  if (!name) return children.map(renderNode).join('');
  let output = `<${name}`;
  for (const [k, v] of Object.entries(attributes ?? {}))
    output += ` ${k.toLowerCase()}="${escapeHtml(String(v))}"`;
  output += '>';
  // Mirrors Markdoc's own void-element handling: we don't emit a
  // closing tag for elements that don't take content. For tooltip
  // templates this is almost always irrelevant, but we preserve the
  // contract so authors moving between Markdoc and our renderer see
  // no shape differences.
  const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ]);
  if (VOID_ELEMENTS.has(name)) return output;
  output += children.map(renderNode).join('');
  output += `</${name}>`;
  return output;
}

// -----------------------------------------------------------------------------
// Markdoc tag schema
// -----------------------------------------------------------------------------

/**
 * Three built-in tags, deliberately kept small. Authors register custom
 * tags by extending `markdocConfig.tags` post-import — a hook exposed
 * via the `viewerConfig.tooltipTags` override.
 */
const markdocConfig = {
  /**
   * Markdoc's default `document` schema wraps every rendered template
   * in `<article>…</article>`. Tooltips are already wrapped by the
   * Nightingale popup container, so the extra element is visual noise
   * and breaks byte-parity with the pre-refactor HTML. Overriding the
   * document render to an empty tag name makes `renderNode` (and the
   * stock Markdoc renderer) emit only the children.
   */
  nodes: {
    document: { ...Markdoc.nodes.document, render: null as unknown as string },
  },
  tags: {
    /**
     * `{% xrefs xrefs=$field /%}` — render a cross-reference list using
     * the shared `formatXrefs` helper.
     */
    xrefs: {
      attributes: { xrefs: { type: Array } },
      transform(node: { transformAttributes(config: unknown): unknown }, config: unknown) {
        const attrs = node.transformAttributes(config) as { xrefs?: unknown[] };
        return rawHtml(formatXrefs((attrs.xrefs ?? []) as Parameters<typeof formatXrefs>[0]));
      },
    },
    /**
     * `{% evidence codes=$field /%}` — render an evidence-code list
     * using the shared `formatEvidence` helper.
     */
    evidence: {
      attributes: { codes: { type: Array } },
      transform(node: { transformAttributes(config: unknown): unknown }, config: unknown) {
        const attrs = node.transformAttributes(config) as { codes?: unknown[] };
        return rawHtml(
          formatEvidence(
            (attrs.codes ?? []) as Parameters<typeof formatEvidence>[0]
          )
        );
      },
    },
    /**
     * `{% link source="pubmed" id=$accession label="PubMed" /%}` —
     * build an anchor using the central link registry. Authors reach
     * for this when they want a link that can be re-pointed by
     * embedders (e.g. intranet mirrors) without editing every
     * template.
     */
    link: {
      selfClosing: true,
      attributes: {
        source: { type: String, required: true },
        id: { type: String, required: true },
        label: { type: String },
      },
      transform(node: { transformAttributes(config: unknown): unknown }, config: unknown) {
        const attrs = node.transformAttributes(config) as {
          source: string;
          id: string;
          label?: string;
        };
        const url = expandLink(attrs.source, attrs.id);
        return new Tag(
          'a',
          { href: url, target: '_blank', rel: 'noopener noreferrer' },
          [attrs.label ?? attrs.id]
        );
      },
    },
  },
};

// -----------------------------------------------------------------------------
// Branch: fields
// -----------------------------------------------------------------------------

/**
 * Apply a `FieldSpec.render` hook — either a named entry in the helper
 * registry or, if unknown, fall through to a plain `<p>`-wrapped escape
 * of the value.
 */
function renderFieldValue(
  field: FieldSpec,
  value: unknown,
  ctx: TooltipContext
): string {
  if (field.render) {
    const helper = tooltipHelpers[field.render];
    if (helper) return helper(value, ctx);
    // Unknown helper name — print the value (caller will see an empty
    // or partial tooltip and have a chance to spot the typo). We don't
    // throw; the roadmap's "didYouMean" pass is the better place to
    // surface registry typos.
    return `<p>${escapeHtml(String(value ?? ''))}</p>`;
  }
  if (value == null || value === '') return '';
  return `<p>${escapeHtml(String(value))}</p>`;
}

function renderFieldsSpec(
  item: unknown,
  fields: FieldSpec[],
  ctx: TooltipContext
): string {
  return fields
    .map((field) => {
      const value = resolvePath(item, field.path);
      if (value == null || value === '') return '';
      return `<h5>${escapeHtml(field.label)}</h5>${renderFieldValue(
        field,
        value,
        ctx
      )}`;
    })
    .filter(Boolean)
    .join('');
}

// -----------------------------------------------------------------------------
// Branch: markdown
// -----------------------------------------------------------------------------

function renderMarkdownSpec(
  item: unknown,
  template: string,
  extraVariables: Record<string, unknown> | undefined,
  ctx: TooltipContext
): string {
  const ast = Markdoc.parse(template);
  const variables = {
    ...(item as Record<string, unknown>),
    ...(extraVariables ?? {}),
    $ctx: ctx,
  };
  const content = Markdoc.transform(ast, {
    ...markdocConfig,
    variables,
  });
  return renderNode(content);
}

// -----------------------------------------------------------------------------
// Auto-fallback for "no spec configured"
// -----------------------------------------------------------------------------

/**
 * When a track has no configured `dataTooltip` and no default for its
 * `kind` (or no `kind` at all), try to salvage a sensible tooltip from
 * the item's shape. Most adapters emit a feature-shaped record with
 * some subset of `{ type, description, start | begin, end }`, so we
 * synthesize a `fields` spec covering those and render via the shared
 * field path.
 *
 * `start` takes precedence over `begin` (the raw UniProt API form) so
 * the "Start" label doesn't appear twice on items that have both.
 * Returns `''` when the item carries none of the recognised fields —
 * matching the previous "no spec" behaviour and letting the loader
 * preserve any adapter-supplied `tooltipContent`.
 */
function renderAutoFallback(item: unknown, ctx: TooltipContext): string {
  if (item == null || typeof item !== 'object') return '';
  const obj = item as Record<string, unknown>;
  const isPresent = (v: unknown): boolean => v != null && v !== '';
  const fields: FieldSpec[] = [];
  if (isPresent(obj.type)) fields.push({ path: 'type', label: 'Type' });
  if (isPresent(obj.description))
    fields.push({ path: 'description', label: 'Description' });
  if (isPresent(obj.start)) fields.push({ path: 'start', label: 'Start' });
  else if (isPresent(obj.begin))
    fields.push({ path: 'begin', label: 'Start' });
  if (isPresent(obj.end)) fields.push({ path: 'end', label: 'End' });
  if (fields.length === 0) return '';
  return renderFieldsSpec(item, fields, ctx);
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/**
 * Render a tooltip HTML string for a single item.
 *
 * When `spec` is `undefined` (e.g. a track with no configured
 * `dataTooltip`, no per-kind default, and no `tooltipOverrides` entry)
 * the resolver falls back to an auto-synthesized spec drawn from common
 * feature-shaped fields — see `renderAutoFallback`. If the item has
 * none of those fields the result is still `''`. Callers attach the
 * returned string to `feature.tooltipContent`; Nightingale reads it on
 * hover.
 */
export function resolveTooltip(
  item: unknown,
  spec: TooltipSpec | undefined,
  ctx: TooltipContext
): string {
  if (!spec) return renderAutoFallback(item, ctx);
  switch (spec.kind) {
    case 'fields':
      return renderFieldsSpec(item, spec.fields, ctx);
    case 'markdown':
      return renderMarkdownSpec(item, spec.template, spec.variables, ctx);
    case 'custom':
      return spec.render(item, ctx);
    default: {
      const _exhaustive: never = spec;
      return String(_exhaustive);
    }
  }
}
