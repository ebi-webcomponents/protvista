/**
 * Smoke coverage for `resolveTooltip`. Each branch (`fields`,
 * `markdown`) gets a representative input.
 */
import { describe, it, expect } from 'vitest';
import { resolveTooltip } from '../resolve';
import type { TooltipContext } from '../types';

const ctx: TooltipContext = {
  accession: 'P05067',
  trackId: 'features-domain',
  kind: 'features',
};

describe('resolveTooltip — fields branch', () => {
  it('emits <h5>label</h5><p>value</p> per populated field', () => {
    const out = resolveTooltip(
      { name: 'APP', description: 'Amyloid precursor' },
      {
        kind: 'fields',
        fields: [
          { path: 'name', label: 'Name' },
          { path: 'description', label: 'Description' },
        ],
      },
      ctx
    );
    expect(out).toBe(
      '<h5>Name</h5><p>APP</p><h5>Description</h5><p>Amyloid precursor</p>'
    );
  });

  it('skips fields whose path resolves to null/undefined/""', () => {
    const out = resolveTooltip(
      { name: 'APP', description: '' },
      {
        kind: 'fields',
        fields: [
          { path: 'name', label: 'Name' },
          { path: 'description', label: 'Description' },
          { path: 'missing.nested', label: 'Missing' },
        ],
      },
      ctx
    );
    expect(out).toBe('<h5>Name</h5><p>APP</p>');
  });

  it('escapes HTML in field values', () => {
    const out = resolveTooltip(
      { note: '<script>x</script>' },
      { kind: 'fields', fields: [{ path: 'note', label: 'Note' }] },
      ctx
    );
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>x</script>');
  });

});

describe('resolveTooltip — markdown branch', () => {
  it('renders a Markdoc heading with a variable interpolation', () => {
    const out = resolveTooltip(
      { variant: 'G12V' },
      {
        kind: 'markdown',
        template: '### {% $variant %}',
      },
      ctx
    );
    expect(out).toContain('<h3>');
    expect(out).toContain('G12V');
  });

});

describe('resolveTooltip — no spec (auto-fallback)', () => {
  it('returns the empty string when the item carries no recognised fields', () => {
    // `{}` has no `type` / `description` / `start` / `begin` / `end` —
    // the auto-fallback has nothing to say.
    expect(resolveTooltip({}, undefined, ctx)).toBe('');
  });

  it('returns the empty string for non-object items', () => {
    expect(resolveTooltip(null, undefined, ctx)).toBe('');
    expect(resolveTooltip(undefined, undefined, ctx)).toBe('');
    expect(resolveTooltip(42, undefined, ctx)).toBe('');
    expect(resolveTooltip('string', undefined, ctx)).toBe('');
  });

  it('synthesizes Type/Description/Start/End on feature-shaped data', () => {
    const out = resolveTooltip(
      { type: 'DOMAIN', description: 'Kinase', start: 10, end: 50 },
      undefined,
      ctx
    );
    expect(out).toBe(
      '<h5>Type</h5><p>DOMAIN</p>' +
        '<h5>Description</h5><p>Kinase</p>' +
        '<h5>Start</h5><p>10</p>' +
        '<h5>End</h5><p>50</p>'
    );
  });

  it('accepts `begin` as a stand-in for `start` (raw UniProt API form)', () => {
    const out = resolveTooltip(
      { type: 'SIGNAL', begin: 1, end: 22 },
      undefined,
      ctx
    );
    expect(out).toBe(
      '<h5>Type</h5><p>SIGNAL</p>' +
        '<h5>Start</h5><p>1</p>' +
        '<h5>End</h5><p>22</p>'
    );
  });

  it('prefers `start` over `begin` if both are present (no duplicate "Start")', () => {
    const out = resolveTooltip(
      { type: 'X', start: 5, begin: 5, end: 9 },
      undefined,
      ctx
    );
    expect(out).toBe(
      '<h5>Type</h5><p>X</p>' +
        '<h5>Start</h5><p>5</p>' +
        '<h5>End</h5><p>9</p>'
    );
  });

  it('skips absent fields gracefully (partial data)', () => {
    const out = resolveTooltip({ type: 'HELIX' }, undefined, ctx);
    expect(out).toBe('<h5>Type</h5><p>HELIX</p>');
  });

  it('escapes HTML in auto-fallback values', () => {
    const out = resolveTooltip(
      { type: '<script>x</script>', description: 'ok' },
      undefined,
      ctx
    );
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>x</script>');
  });
});

// -----------------------------------------------------------------------------
// Branch: fields — corner cases
// -----------------------------------------------------------------------------

describe('resolveTooltip — fields dot-path resolution', () => {
  it('walks nested paths segment by segment', () => {
    const out = resolveTooltip(
      { a: { b: { c: 'deep' } } },
      { kind: 'fields', fields: [{ path: 'a.b.c', label: 'C' }] },
      ctx
    );
    expect(out).toBe('<h5>C</h5><p>deep</p>');
  });

  it('supports numeric segments for array indexing', () => {
    const out = resolveTooltip(
      { items: ['first', 'second'] },
      { kind: 'fields', fields: [{ path: 'items.1', label: 'Item' }] },
      ctx
    );
    expect(out).toBe('<h5>Item</h5><p>second</p>');
  });

  it('treats a missing mid-segment the same as undefined', () => {
    const out = resolveTooltip(
      { a: null },
      { kind: 'fields', fields: [{ path: 'a.b.c', label: 'X' }] },
      ctx
    );
    expect(out).toBe('');
  });
});

describe('resolveTooltip — fields label / value escaping', () => {
  it('escapes special characters in the field label', () => {
    const out = resolveTooltip(
      { v: 1 },
      { kind: 'fields', fields: [{ path: 'v', label: '<x>' }] },
      ctx
    );
    expect(out).toBe('<h5>&lt;x&gt;</h5><p>1</p>');
  });
});

// -----------------------------------------------------------------------------
// Branch: markdown — renderer edge cases
// -----------------------------------------------------------------------------

describe('resolveTooltip — markdown renderer quirks', () => {
  it('does not wrap the output in an <article> (document render suppressed)', () => {
    const out = resolveTooltip(
      {},
      { kind: 'markdown', template: 'plain text' },
      ctx
    );
    // Stock Markdoc would wrap this in `<article><p>plain text</p></article>`;
    // we suppress the document wrapper so tooltips sit flush inside the
    // Nightingale popup.
    expect(out).not.toContain('<article>');
    expect(out).toContain('<p>plain text</p>');
  });

  it('merges `variables` into the Markdoc scope alongside the item', () => {
    const out = resolveTooltip(
      { a: '1' },
      {
        kind: 'markdown',
        template: '{% $a %}-{% $b %}',
        variables: { b: '2' },
      },
      ctx
    );
    expect(out).toContain('1-2');
  });
});

