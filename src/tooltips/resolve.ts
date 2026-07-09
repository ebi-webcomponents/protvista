/**
 * Tooltip resolver — converts a `TooltipSpec` plus an item into an HTML
 * string that Nightingale will read off `feature.tooltipContent` on hover.
 *
 * Two branches:
 *
 *   - `kind: 'fields'`   — deterministic HTML synthesis from a field list.
 *                         Each `FieldSpec` becomes `<h5>label</h5>` followed
 *                         by a plain `<p>`-wrapped escape of the value at
 *                         `path`.
 *   - `kind: 'markdown'` — Markdoc parse → transform → render. The item is
 *                         flattened into the Markdoc variable scope so
 *                         authors reference fields as `{% $fieldName %}`.
 *                         Plain Markdoc only; no domain-specific tags.
 *
 * There is no `kind: 'custom'` branch and no programmatic per-kind
 * override surface. Consumers who need rich / interactive / stateful
 * tooltips listen for the Nightingale `change` event, mount their
 * own UI, and suppress the library's built-in popover with the
 * `notooltip` attribute on the element.
 *
 * The `kind: markdown` branch runs Markdoc's `renderers.html`, which
 * HTML-escapes every string node by design. `renderNode` below is a
 * thin walker that delegates to that stock renderer for every node
 * kind we care about (text / paragraph / inline formatting /
 * conditional blocks).
 */
import Markdoc, { Tag, type RenderableTreeNode } from '@markdoc/markdoc';
import type { TooltipContext, TooltipSpec, FieldSpec } from './types';
import { escapeHtml, sanitizeUrl } from '../utils/security';

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
  for (const [k, v] of Object.entries(attributes ?? {})) {
    const attr = k.toLowerCase();
    const value =
      name === 'a' && attr === 'href'
        ? sanitizeUrl(v)
        : escapeHtml(String(v));
    output += ` ${attr}="${value}"`;
  }
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
 * Rich, consumer-specific rendering goes through the event-listener
 * pattern (listen for the Nightingale `change` event, mount your own
 * UI, set `notooltip` on the element) rather than per-field hooks
 * inside a `kind: 'fields'` spec.
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
  // Markdoc looks up `{% $foo %}` template references against this
  // map by the unprefixed key (`foo`), so `ctx` is stored under its
  // bare name. Authored templates reach per-track context via
  // `{% $ctx.accession %}`, `{% $ctx.trackId %}`, `{% $ctx.kind %}`.
  const variables = {
    ...(item as Record<string, unknown>),
    ...(extraVariables ?? {}),
    ctx,
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

const AUTO_FALLBACK_MAX_ROWS = 10;

const AUTO_FALLBACK_RESERVED_KEYS = new Set([
  'alternativeSequence',
  'begin',
  'clinicalSignificances',
  'color',
  'consequenceType',
  'description',
  'end',
  'evidences',
  'hasPredictions',
  'locations',
  'protvistaFeatureId',
  'residuesToHighlight',
  'score',
  'shape',
  'start',
  'tooltipContent',
  'type',
  'variant',
  'variants',
  'wildType',
  'xrefNames',
  'xrefs',
]);

type AutoFallbackRow = {
  label: string;
  value?: unknown;
  markdown?: string;
  variables?: Record<string, unknown>;
};

const isPresent = (value: unknown): boolean => {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const isScalar = (value: unknown): value is string | number | boolean =>
  ['string', 'number', 'boolean'].includes(typeof value);

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Number(value.toPrecision(3)).toString();
}

function formatScore(value: unknown, kind: string): string {
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) return String(value);
  if (kind === 'confidence-score') {
    return Number.isInteger(value)
      ? String(value)
      : Number(value.toFixed(1)).toString();
  }
  return formatNumber(value);
}

function scoreLabel(kind: string): string {
  if (kind === 'confidence-score') return 'pLDDT';
  if (kind.startsWith('pathogenicity')) return 'Pathogenicity score';
  return 'Score';
}

function labelFromKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/);
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function scalarValue(value: unknown): string {
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

function clinicalSignificanceLabel(value: unknown): string {
  if (isScalar(value)) return String(value);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const label = obj.type ?? obj.label ?? obj.name;
    if (isScalar(label)) return String(label);
  }
  return '';
}

function formatClinicalSignificances(value: unknown): string {
  const values = Array.isArray(value) ? value : [value];
  return values.map(clinicalSignificanceLabel).filter(Boolean).join(', ');
}

function firstScalar(...values: unknown[]): string {
  for (const value of values) {
    if (isScalar(value) && String(value) !== '') return String(value);
  }
  return '';
}

function xrefLabel(value: unknown): string {
  if (isScalar(value)) return String(value);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return firstScalar(
      obj.name,
      obj.id,
      obj.accession,
      obj.database,
      obj.source
    );
  }
  return '';
}

function xrefUrl(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  return obj.url ?? obj.href;
}

function markdownLinkDestination(value: unknown): string {
  return String(value)
    .trim()
    .replace(/[\s()<>]/g, (char) => encodeURIComponent(char));
}

function formatXrefs(value: unknown): Pick<
  AutoFallbackRow,
  'markdown' | 'variables'
> | null {
  const xrefs = Array.isArray(value) ? value : [value];
  const variables: Record<string, unknown> = {};
  const parts = xrefs
    .map((xref, index) => {
      const label = xrefLabel(xref);
      if (!label) return '';
      const textKey = `autoFallbackXref${index}Text`;
      variables[textKey] = label;
      const url = xrefUrl(xref);
      if (sanitizeUrl(url)) {
        return `[{% $${textKey} %}](${markdownLinkDestination(url)})`;
      }
      return `{% $${textKey} %}`;
    })
    .filter(Boolean);
  if (parts.length === 0) return null;
  return { markdown: parts.join(', '), variables };
}

function evidenceSource(value: unknown): string {
  if (isScalar(value)) return String(value);
  if (!value || typeof value !== 'object') return '';
  const obj = value as Record<string, unknown>;
  const source = obj.source;
  if (isScalar(source)) return String(source);
  if (source && typeof source === 'object') {
    const sourceObj = source as Record<string, unknown>;
    return firstScalar(sourceObj.id, sourceObj.name, sourceObj.url);
  }
  return firstScalar(obj.sourceId, obj.sourceName, obj.url, obj.code);
}

function formatEvidences(value: unknown): string {
  const evidences = Array.isArray(value) ? value : [value];
  const count = evidences.length;
  const firstSource = evidenceSource(evidences[0]);
  const summary = `${count} ${count === 1 ? 'evidence' : 'evidences'}`;
  return firstSource ? `${summary}; first source: ${firstSource}` : summary;
}

function variantValue(obj: Record<string, unknown>): string {
  const alternate = isPresent(obj.alternativeSequence)
    ? obj.alternativeSequence
    : obj.variant;
  if (isPresent(obj.wildType) && isPresent(alternate)) {
    return `${String(obj.wildType)} -> ${String(alternate)}`;
  }
  if (isPresent(alternate)) return String(alternate);
  return '';
}

function buildAutoFallbackRows(
  obj: Record<string, unknown>,
  ctx: TooltipContext
): AutoFallbackRow[] {
  const rows: AutoFallbackRow[] = [];
  const add = (label: string, value: unknown) => {
    if (isPresent(value)) rows.push({ label, value });
  };

  add('Type', obj.type);
  add('Description', obj.description);

  const start = isPresent(obj.start) ? obj.start : obj.begin;
  if (isPresent(start) && isPresent(obj.end)) {
    if (String(start) === String(obj.end)) add('Position', start);
    else {
      add('Start', start);
      add('End', obj.end);
    }
  } else {
    add('Start', start);
    add('End', obj.end);
  }

  add('Variant', variantValue(obj));
  add('Consequence', obj.consequenceType);

  const clinicalSignificances = formatClinicalSignificances(
    obj.clinicalSignificances
  );
  add('Clinical significance', clinicalSignificances);

  if (isPresent(obj.score)) {
    rows.push({
      label: scoreLabel(ctx.kind),
      value: formatScore(obj.score, ctx.kind),
    });
  }

  const xrefs = formatXrefs(obj.xrefs);
  if (xrefs) {
    rows.push({
      label: 'Cross-references',
      ...xrefs,
    });
  }

  if (isPresent(obj.evidences)) {
    add('Evidence', formatEvidences(obj.evidences));
  }

  for (const [key, value] of Object.entries(obj)) {
    if (rows.length >= AUTO_FALLBACK_MAX_ROWS) break;
    if (key.startsWith('_')) continue;
    if (AUTO_FALLBACK_RESERVED_KEYS.has(key)) continue;
    if (!isPresent(value) || !isScalar(value)) continue;
    rows.push({ label: labelFromKey(key), value: scalarValue(value) });
  }

  return rows.slice(0, AUTO_FALLBACK_MAX_ROWS);
}

function renderAutoFallbackRows(
  rows: AutoFallbackRow[],
  ctx: TooltipContext
): string {
  const variables: Record<string, unknown> = {};
  const template = rows
    .map((row, index) => {
      const heading = `##### ${row.label}`;
      if (row.markdown) {
        Object.assign(variables, row.variables);
        return `${heading}\n\n${row.markdown}`;
      }
      const key = `autoFallbackValue${index}`;
      variables[key] = row.value;
      return `${heading}\n\n{% $${key} %}`;
    })
    .join('\n\n');
  return renderMarkdownSpec({}, template, variables, ctx);
}

/**
 * When a track has no configured `dataTooltip` and no default for its
 * `kind` (or no `kind` at all), try to salvage a sensible tooltip from
 * the item's shape. The fallback stays compact, but it now includes
 * common rich fields emitted by adapters and post-adapter transforms:
 * variant details, significance, scores, xrefs, evidences, and any
 * remaining top-level scalar slots.
 *
 * `start` takes precedence over `begin` (the raw UniProt API form) so
 * the "Start" label doesn't appear twice on items that have both. The
 * synthesized content is rendered through Markdoc so fallback links and
 * escaping follow the same path as authored markdown tooltips.
 */
function renderAutoFallback(item: unknown, ctx: TooltipContext): string {
  if (item == null || typeof item !== 'object') return '';
  const obj = item as Record<string, unknown>;
  const rows = buildAutoFallbackRows(obj, ctx);
  if (rows.length === 0) return '';
  return renderAutoFallbackRows(rows, ctx);
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

/**
 * Render a tooltip HTML string for a single item.
 *
 * When `spec` is `undefined` (e.g. a track with no configured
 * `dataTooltip` and no per-kind default) the resolver falls back to
 * compact Markdoc content drawn from common adapted payload fields —
 * see `renderAutoFallback`. If the item has none of those fields the
 * result is still `''`. Callers attach the returned string to
 * `feature.tooltipContent`; Nightingale reads it on hover.
 */
export function resolveTooltip(
  item: unknown,
  spec: TooltipSpec | undefined,
  ctx: TooltipContext
): string {
  if (!spec) return renderAutoFallback(item, ctx);
  switch (spec.kind) {
    case 'fields':
      return renderFieldsSpec(item, spec.fields);
    case 'markdown':
      return renderMarkdownSpec(item, spec.template, spec.variables, ctx);
    default: {
      const _exhaustive: never = spec;
      return String(_exhaustive);
    }
  }
}
