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

function htmlFragment(html: string): HTMLDivElement {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const div = document.createElement('div');
  div.append(...Array.from(doc.body.childNodes));
  return div;
}

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

  it('surfaces compact variant details, significance, and xrefs', () => {
    const out = resolveTooltip(
      {
        type: 'VARIANT',
        begin: 12,
        end: 12,
        wildType: 'G',
        alternativeSequence: 'V',
        consequenceType: 'missense',
        clinicalSignificances: [
          { type: 'Pathogenic' },
          { type: 'Likely pathogenic' },
        ],
        xrefs: [
          {
            name: 'ClinVar',
            url: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/123',
          },
        ],
      },
      undefined,
      { ...ctx, kind: 'variants' }
    );

    expect(out).toMatchInlineSnapshot(
      `"<h5>Type</h5><p>VARIANT</p><h5>Position</h5><p>12</p><h5>Variant</h5><p>G -&gt; V</p><h5>Consequence</h5><p>missense</p><h5>Clinical significance</h5><p>Pathogenic, Likely pathogenic</p><h5>Cross-references</h5><p><a href="https://www.ncbi.nlm.nih.gov/clinvar/variation/123">ClinVar</a></p>"`
    );
  });

  it('linkifies only xrefs whose URL passes the tooltip URL allowlist', () => {
    const out = resolveTooltip(
      {
        type: 'BINDING',
        start: 45,
        end: 52,
        xrefs: [
          {
            name: 'InterPro',
            url: 'https://www.ebi.ac.uk/interpro/entry/InterPro/IPR000001',
          },
          { name: 'Bad', url: 'javascript:alert(1)' },
          { name: 'Plain' },
        ],
      },
      undefined,
      ctx
    );
    const html = htmlFragment(out);
    const links = html.querySelectorAll('a');

    expect(out).toMatchInlineSnapshot(
      `"<h5>Type</h5><p>BINDING</p><h5>Start</h5><p>45</p><h5>End</h5><p>52</p><h5>Cross-references</h5><p><a href="https://www.ebi.ac.uk/interpro/entry/InterPro/IPR000001">InterPro</a>, Bad, Plain</p>"`
    );
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('InterPro');
    expect(links[0].getAttribute('href')).toBe(
      'https://www.ebi.ac.uk/interpro/entry/InterPro/IPR000001'
    );
    expect(html.textContent).toContain('Bad');
    expect(html.textContent).toContain('Plain');
  });

  it('uses remaining slots for top-level scalar fields such as calculated values', () => {
    const out = resolveTooltip(
      {
        type: 'REGION',
        start: 10,
        end: 15,
        lengthInclusive: 6,
        confidenceBand: 'high',
      },
      undefined,
      ctx
    );

    expect(out).toBe(
      '<h5>Type</h5><p>REGION</p>' +
        '<h5>Start</h5><p>10</p>' +
        '<h5>End</h5><p>15</p>' +
        '<h5>Length Inclusive</h5><p>6</p>' +
        '<h5>Confidence Band</h5><p>high</p>'
    );
  });

  it('formats score and evidence summaries from adapted payload fields', () => {
    const out = resolveTooltip(
      {
        type: 'MOD_RES',
        start: 42,
        end: 42,
        score: 0.98765,
        evidences: [
          { code: 'ECO:0000269', source: { id: 'PubMed:1' } },
          { code: 'ECO:0000305', source: { id: 'UniProt' } },
        ],
      },
      undefined,
      { ...ctx, kind: 'pathogenicity-score' }
    );

    expect(out).toBe(
      '<h5>Type</h5><p>MOD_RES</p>' +
        '<h5>Position</h5><p>42</p>' +
        '<h5>Pathogenicity score</h5><p>0.988</p>' +
        '<h5>Evidence</h5><p>2 evidences; first source: PubMed:1</p>'
    );
  });

  it('keeps the auto-fallback compact by rendering at most ten rows', () => {
    const out = resolveTooltip(
      {
        type: 'VARIANT',
        description: 'many fields',
        start: 12,
        end: 12,
        wildType: 'G',
        alternativeSequence: 'V',
        consequenceType: 'missense',
        clinicalSignificances: [{ type: 'Pathogenic' }],
        score: 0.98765,
        xrefs: [{ name: 'ClinVar', url: 'https://example.org/clinvar/123' }],
        derivedScore: 42,
        secondDerivedScore: 43,
        thirdDerivedScore: 44,
      },
      undefined,
      { ...ctx, kind: 'variants' }
    );
    const labels = Array.from(htmlFragment(out).querySelectorAll('h5')).map(
      (heading) => heading.textContent
    );

    expect(labels).toEqual([
      'Type',
      'Description',
      'Position',
      'Variant',
      'Consequence',
      'Clinical significance',
      'Score',
      'Cross-references',
      'Derived Score',
      'Second Derived Score',
    ]);
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
