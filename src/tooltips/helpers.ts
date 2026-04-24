/**
 * General-purpose formatter registry for tooltip rendering.
 *
 * These helpers take an arbitrary value plucked from the feature at a
 * `FieldSpec.path` (or from a Markdoc tag attribute) and return an HTML
 * string. Each is pure — no DOM, no network, no `this`.
 *
 * Ported from the inline formatters previously embedded inside
 * `src/tooltips/feature-tooltip.ts`. The pre-refactor pipeline trusted
 * every adapter-supplied string (including upstream-controlled URLs
 * and descriptions) and interpolated them raw into attribute positions.
 * That was an XSS sink: a `javascript:`-scheme URL or an attribute-
 * breaking payload flowing through UniProt / InterPro / PubMed JSON
 * would land in the click-tooltip's `innerHTML` and fire. Post-refactor
 * every dynamic value is routed through `escapeHtml` (for text and
 * attributes) plus `sanitizeUrl` (for anchor `href=` attributes, which
 * constrains the scheme to `http` / `https` / `mailto`). Whitespace
 * layout and `&nbsp;` punctuation is unchanged — the escape pass only
 * affects characters that would otherwise let a payload change
 * structure.
 *
 * Callers (`FieldSpec.render` and the per-kind `tooltipDefaults`
 * entries) consume these via the `tooltipHelpers` registry at the
 * bottom of the file. The registry is frozen at export time so
 * downstream code can't inject a helper that produces unescaped
 * HTML — the `fields` resolver trusts helpers unconditionally, so
 * registry tamperability would be an XSS sink of its own.
 *
 * Out of scope for this module: kind-specific HTML construction (PTM
 * peptidoforms, variation population tables, RNA-editing link blocks).
 * Those live in `defaults.ts` and stay next to the data they format.
 */
import ecoMap from '../adapters/config/evidence';
import { escapeHtml, sanitizeUrl } from '../utils/security';
import type { TooltipHelper } from './types';

// -----------------------------------------------------------------------------
// Narrow input shapes
// -----------------------------------------------------------------------------
//
// These are descriptive, not defensive — the ported formatters used plain
// `any` access patterns that we preserve. Defining the shapes keeps the
// helper call sites typed without forcing every adapter output type to
// inherit a shared base.

interface EvidenceSource {
  id?: string;
  name?: string;
  url?: string;
  alternativeUrl?: string;
}

interface EvidenceItem {
  code?: string;
  source?: EvidenceSource;
}

interface Xref {
  id?: string;
  name?: string;
  url?: string;
}

// -----------------------------------------------------------------------------
// Public typed helpers
// -----------------------------------------------------------------------------

/**
 * Render an evidence source (the inner <a>…</a> fragment inside the
 * evidence code `<li>`). PubMed sources get a dual PubMed / Europe PMC
 * link pair; other sources collapse to a single labeled anchor. Source
 * names beginning with `Hpp` (Human Proteome Project PeptideAtlas) are
 * shortened in the parenthesized annotation to match the pre-refactor
 * output.
 *
 * Kept as a module-internal helper rather than a registry entry because
 * it consumes a structured `EvidenceSource` object, not a plain value.
 */
export function formatSource(source: EvidenceSource): string {
  const id = escapeHtml(source.id);
  const name = escapeHtml(source.name);
  const urlAttr = sanitizeUrl(source.url);
  if (source.name?.toLowerCase() === 'pubmed') {
    const altUrlAttr = sanitizeUrl(source.alternativeUrl);
    return `${id}&nbsp;(<a href='${urlAttr}' target='_blank'>${name}</a>&nbsp;<a href='${altUrlAttr}' target='_blank'>EuropePMC</a>)`;
  }
  const sourceLink = `&nbsp;<a href='${urlAttr}' target='_blank'>${id}</a>`;
  if (source.name) {
    // Temporary until we get the expected value as 'PeptideAtlas' instead
    // of 'HppPeptideAtlas' (carried over verbatim from the pre-refactor
    // comment in feature-tooltip.ts).
    if (source.name.startsWith('Hpp')) {
      return `${sourceLink}&nbsp;(${escapeHtml(source.name.slice(3))})`;
    }
    return `${sourceLink}&nbsp;(${name})`;
  }
  return sourceLink;
}

/**
 * Render an evidence-code list as an unordered list of ECO descriptions.
 *
 * Each item resolves its ECO code against `ecoMap` (the in-tree evidence
 * registry) and emits the short description as the `<li>` label with the
 * long description in the `title=` attribute. Evidence codes that don't
 * resolve are silently skipped, matching the pre-refactor behaviour.
 *
 * Returns an empty string when `evidenceList` is `undefined`/`null` so
 * callers can unconditionally inject the result into a template without
 * null-guarding each site.
 */
export function formatEvidence(
  evidenceList: EvidenceItem[] | undefined | null
): string {
  if (!evidenceList) return '';
  return `
        <ul class="no-bullet">${evidenceList
          .map((ev) => {
            const ecoMatch = ecoMap.find((eco) => eco.name === ev.code);
            if (!ecoMatch) return '';
            // `ecoMap` is a bundled in-tree registry (low risk) but the
            // same escape pass runs here so future entries can't drift
            // into an unescaped state via copy-paste.
            return `<li title='${escapeHtml(ecoMatch.description)}'>${escapeHtml(
              ecoMatch.shortDescription
            )}:&nbsp;${ev.source ? formatSource(ev.source) : ''}</li>`;
          })
          .join('')}</ul>
      `;
}

/**
 * Render a cross-reference list (`xrefs`) as an unordered list of
 * external-database anchors.
 *
 * Quirk preserved from the pre-refactor output: when a cross-reference
 * has no URL, the `xref.name` is repeated inside the list item so the
 * rendered text reads "NAME NAME ID" rather than bare "NAME ID".
 */
export function formatXrefs(xrefs: Xref[]): string {
  return `<ul class="no-bullet">${xrefs
    .map((xref) => {
      const name = escapeHtml(xref.name);
      const id = escapeHtml(xref.id);
      return `<li>${name} ${
        xref.url
          ? `<a href="${sanitizeUrl(xref.url)}" target="_blank">${id}</a>`
          : `${name} ${id}`
      }</li>`;
    })
    .join('')}</ul>`;
}

// -----------------------------------------------------------------------------
// Registry — for Markdoc tag resolution and FieldSpec.render hooks
// -----------------------------------------------------------------------------

/**
 * Every registered helper accepts `(value, ctx)` per the `TooltipHelper`
 * contract so field specs can plug them in without knowing the
 * underlying typed signature. Callers that know the shape (e.g. the
 * ported `tooltipDefaults` entries) should import the typed exports
 * above instead.
 *
 * Frozen at export time so downstream code can't mutate the registry to
 * swap in a helper that returns an unescaped payload. The `fields`
 * resolver (`tooltips/resolve.ts`) trusts helper output unconditionally,
 * so tamper-resistance here is part of the XSS surface. Adopters who
 * need a custom helper should register it through a track's
 * `tooltipOverrides` `kind: 'custom'` render function and own the
 * escaping themselves.
 */
export const tooltipHelpers: Readonly<Record<string, TooltipHelper>> =
  Object.freeze({
    xrefs: (value) => formatXrefs((value ?? []) as Xref[]),
    evidence: (value) =>
      formatEvidence(value as EvidenceItem[] | undefined | null),
  });
