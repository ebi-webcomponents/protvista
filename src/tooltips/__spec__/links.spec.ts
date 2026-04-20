/**
 * Coverage for the external-URL registry (`tooltipLinks`) and its
 * template-expansion helper (`expandLink`).
 *
 * The registry is the single override point for embedders who need to
 * point at internal mirrors, so the contract we test here is the one
 * those embedders depend on:
 *
 *   - every placeholder is `encodeURIComponent`-escaped;
 *   - single-placeholder templates accept either a bare string or a
 *     `{ id }` object;
 *   - multi-placeholder templates only accept the object form;
 *   - missing placeholders expand to an empty segment rather than
 *     throwing (keeps runtime forgiving — rendered link may 404 but
 *     the tooltip itself won't break);
 *   - an unknown `source` falls back to the id so a missing registry
 *     entry is still visible in the UI.
 */
import { describe, it, expect } from 'vitest';
import { tooltipLinks, expandLink } from '../links';

describe('tooltipLinks registry', () => {
  it('carries the expected built-in keys', () => {
    // Ordered to match the source; if we deliberately drop or rename
    // a key the list below needs an obvious update, which is the
    // point of asserting it explicitly.
    expect(Object.keys(tooltipLinks)).toEqual([
      'pubmed',
      'europepmc',
      'proteomexchange',
      'proteomexchange-usi',
      'pride',
      'peptideatlas',
      'unimod',
      'interpro',
      'interpro-integrated',
      'ensembl-covid',
      'ensembl',
      'rediportal',
    ]);
  });
});

describe('expandLink', () => {
  it('accepts a bare string for a single-placeholder template', () => {
    expect(expandLink('pubmed', '12345')).toBe(
      'https://pubmed.ncbi.nlm.nih.gov/12345'
    );
  });

  it('accepts a `{ id }` object for a single-placeholder template', () => {
    expect(expandLink('pubmed', { id: '12345' })).toBe(
      'https://pubmed.ncbi.nlm.nih.gov/12345'
    );
  });

  it('substitutes multi-placeholder templates', () => {
    expect(
      expandLink('interpro', { source: 'pfam', id: 'PF00001' })
    ).toBe('https://www.ebi.ac.uk/interpro/entry/pfam/PF00001/');
  });

  it('URL-encodes every substitution', () => {
    expect(expandLink('pubmed', 'a b/c')).toBe(
      'https://pubmed.ncbi.nlm.nih.gov/a%20b%2Fc'
    );
  });

  it('expands missing placeholders to empty strings', () => {
    // The `interpro` template needs both source and id — passing only
    // id should yield an empty `source` slot rather than throwing.
    expect(expandLink('interpro', { id: 'PF00001' })).toBe(
      'https://www.ebi.ac.uk/interpro/entry//PF00001/'
    );
  });

  it('falls back to the raw id when the source is unregistered', () => {
    expect(expandLink('nope', '12345')).toBe('12345');
    expect(expandLink('nope', { id: '12345' })).toBe('12345');
  });

  it('returns "" when an unregistered source has no `id` key', () => {
    expect(expandLink('nope', { other: 'x' })).toBe('');
  });
});
