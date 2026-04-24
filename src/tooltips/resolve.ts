/**
 * Tooltip resolver — converts a `TooltipSpec` plus an item into an HTML
 * string that Nightingale will read off `feature.tooltipContent` on hover.
 *
 * Three branches:
 *
 *   - `kind: 'fields'`   — deterministic HTML synthesis from a field list.
 *                         Each `FieldSpec` becomes `<h5>label</h5>` followed
 *                         by a plain `<p>`-wrapped escape of the value at
 *                         `path`. No per-field render hooks — consumers
 *                         that need custom rendering reach for
 *                         `tooltipOverrides[kind]` with `kind: 'custom'`.
 *   - `kind: 'markdown'` — Markdoc parse → transform → render. The item is
 *                         flattened into the Markdoc variable scope so
 *                         authors reference fields as `{% $fieldName %}`.
 *                         Plain Markdoc only; no domain-specific tags.
 *   - `kind: 'custom'`   — verbatim call to the render function. The
 *                         programmatic escape hatch — no safety railings,
 *                         authors get full DOM access via their own Lit /
 *                         hand-rolled output.
 *
 * The `kind: markdown` branch runs Markdoc's `renderers.html`, which
 * HTML-escapes every string node by design. `renderNode` below is a
 * thin walker that delegates to that stock renderer for every node
 * kind we care about (text / paragraph / inline formatting /
 * conditional blocks).
 */
import Markdoc, { Tag, type RenderableTreeNode } from '@markdoc/markdoc';
import type { TooltipContext, TooltipSpec, FieldSpec } from './types';
import { escapeHtml } from '../utils/security';

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
// Renderer walker
// -----------------------------------------------------------------------------

/**
 * Walk a Markdoc `RenderableTreeNode` and emit an HTML string. Thin
 * wrapper around `Markdoc.renderers.html` for scalar and array nodes;
 * synthesises the tag markup for Tag nodes so nested children are
 * rendered through this same walker.
 */
function renderNode(node: RenderableTreeNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return Markdoc.renderers.html(node);
  }
  if (Array.isArray(node)) {
    return node.map(renderNode).join('');
  }
  if (node == null || typeof node !== 'object' || !Tag.isTag(node)) return '';
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
 * Markdoc config for the `kind: markdown` branch. Intentionally minimal:
 * authors get plain Markdoc (fields via `{% $field %}`, conditionals via
 * `{% if %}`/`{% /if %}`) and nothing more. No domain-specific tags.
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
};

// -----------------------------------------------------------------------------
// Branch: fields
// -----------------------------------------------------------------------------

/**
 * Render a `FieldSpec` value as a plain `<p>`-wrapped HTML-escape.
 * Rich, consumer-specific rendering goes through the per-kind
 * `tooltipOverrides[kind]` escape hatch with `kind: 'custom'` rather
 * than per-field hooks inside a `kind: 'fields'` spec.
 */
function renderFieldValue(value: unknown): string {
  if (value == null || value === '') return '';
  return `<p>${escapeHtml(String(value))}</p>`;
}

function renderFieldsSpec(item: unknown, fields: FieldSpec[]): string {
  return fields
    .map((field) => {
      const value = resolvePath(item, field.path);
      if (value == null || value === '') return '';
      return `<h5>${escapeHtml(field.label)}</h5>${renderFieldValue(value)}`;
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
 * Returns `''` when the item carries none of the recognised fields;
 * the caller skips the assignment rather than stamping an empty
 * `tooltipContent`.
 */
function renderAutoFallback(item: unknown): string {
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
  return renderFieldsSpec(item, fields);
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
  if (!spec) return renderAutoFallback(item);
  switch (spec.kind) {
    case 'fields':
      return renderFieldsSpec(item, spec.fields);
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
