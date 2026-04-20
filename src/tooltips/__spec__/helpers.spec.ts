/**
 * Byte-parity coverage for the shared tooltip helper registry.
 *
 * Every helper in `src/tooltips/helpers.ts` was lifted verbatim from the
 * pre-refactor `feature-tooltip.ts`; these tests pin down the exact HTML
 * strings each helper produces so future refactors can't drift quirks
 * like the duplicated `xref.name` on URL-less cross-references or the
 * `Hpp`-prefix shortening inside source annotations.
 *
 * Post-hardening note: dynamic values are now HTML-escaped and URLs are
 * run through a scheme allowlist. Safe inputs look identical apart from
 * the `&#39;` / `&quot;` / `&amp;` byte sequences; unsafe inputs
 * collapse to empty `href=""` (rejected schemes) or to escaped entities
 * (attribute-break attempts). The `XSS regression` block below pins
 * these down so a regression can't slip past the next refactor.
 */
import { describe, it, expect } from 'vitest';
import {
  formatSource,
  formatEvidence,
  formatXrefs,
  tooltipHelpers,
} from '../helpers';

describe('formatSource', () => {
  it('emits a PubMed / Europe PMC link pair for pubmed sources', () => {
    const out = formatSource({
      id: '12345',
      name: 'PubMed',
      url: 'https://pubmed/12345',
      alternativeUrl: 'https://europepmc/12345',
    });
    expect(out).toBe(
      "12345&nbsp;(<a href='https://pubmed/12345' target='_blank'>PubMed</a>&nbsp;<a href='https://europepmc/12345' target='_blank'>EuropePMC</a>)"
    );
  });

  it('matches the lowercase name check case-insensitively', () => {
    // The pre-refactor formatter lowercases before comparing, so
    // `pubmed` and `PUBMED` both trigger the dual-link branch.
    const out = formatSource({
      id: '1',
      name: 'pubmed',
      url: 'u',
      alternativeUrl: 'a',
    });
    expect(out).toContain('EuropePMC');
  });

  it('strips the `Hpp` prefix in the parenthesised annotation', () => {
    const out = formatSource({
      id: 'B1',
      name: 'HppPeptideAtlas',
      url: 'https://x',
    });
    expect(out).toBe(
      "&nbsp;<a href='https://x' target='_blank'>B1</a>&nbsp;(PeptideAtlas)"
    );
  });

  it('emits a single-label anchor when `name` is absent', () => {
    const out = formatSource({ id: 'X1', url: 'http://y' });
    expect(out).toBe("&nbsp;<a href='http://y' target='_blank'>X1</a>");
  });
});

describe('formatEvidence', () => {
  it('returns "" on nullish input (callers rely on unconditional inject)', () => {
    expect(formatEvidence(undefined)).toBe('');
    expect(formatEvidence(null)).toBe('');
  });

  it('renders one <li> per resolvable ECO code, with title= long description', () => {
    const out = formatEvidence([
      {
        code: 'ECO:0000269',
        source: { id: '111', name: 'PubMed', url: 'u', alternativeUrl: 'a' },
      },
    ]);
    expect(out).toContain(
      '<li title=\'Manual assertion based on experiment\'>Publication:&nbsp;'
    );
    expect(out).toContain('EuropePMC');
  });

  it('silently drops evidence codes that don\'t resolve against the ECO map', () => {
    const out = formatEvidence([
      { code: 'ECO:UNKNOWN', source: { id: '1', name: 'PubMed', url: 'u' } },
    ]);
    // The outer <ul> is always emitted; when nothing resolves, the join
    // produces an empty inner body.
    expect(out).toContain('<ul class="no-bullet">');
    expect(out).not.toContain('<li');
  });
});

describe('formatXrefs', () => {
  it('links with an anchor when `url` is present', () => {
    const out = formatXrefs([
      { id: 'CHEMBL1', name: 'ChEMBL', url: 'https://c' },
    ]);
    expect(out).toBe(
      '<ul class="no-bullet"><li>ChEMBL <a href="https://c" target="_blank">CHEMBL1</a></li></ul>'
    );
  });

  it('preserves the pre-refactor duplicated-name quirk when `url` is missing', () => {
    // This is a documented oddity of the original formatter — the
    // rendered text reads "NAME NAME ID" rather than "NAME ID". We
    // preserve it rather than silently "fix" the markup.
    const out = formatXrefs([{ id: 'X1', name: 'Foo' }]);
    expect(out).toBe(
      '<ul class="no-bullet"><li>Foo Foo X1</li></ul>'
    );
  });

  it('renders an empty <ul> for an empty list', () => {
    expect(formatXrefs([])).toBe('<ul class="no-bullet"></ul>');
  });
});

describe('tooltipHelpers registry', () => {
  it('exposes `xrefs` that defaults nullish input to []', () => {
    expect(tooltipHelpers.xrefs(undefined, {} as never)).toBe(
      '<ul class="no-bullet"></ul>'
    );
  });

  it('exposes `evidence` that round-trips through formatEvidence', () => {
    expect(tooltipHelpers.evidence(null, {} as never)).toBe('');
  });

  it('is frozen — downstream code cannot tamper with the registry', () => {
    // Tamper-resistance matters because the Markdoc renderer trusts
    // helper output unconditionally via the `$raw-html` marker tag. A
    // helper swap that returned `${userInput}` unescaped would bypass
    // every other sanitisation layer, so the registry is `Object.freeze`d
    // at export time.
    expect(Object.isFrozen(tooltipHelpers)).toBe(true);
    // `use strict` in TS modules makes assignments to frozen props
    // throw at runtime; we exercise the behaviour here.
    expect(() => {
      (tooltipHelpers as unknown as Record<string, unknown>).xrefs = () =>
        '<script>';
    }).toThrow();
  });
});

describe('XSS regression coverage', () => {
  it('strips `javascript:` URLs from formatSource `href=`', () => {
    const out = formatSource({
      id: 'X',
      name: 'evil',
      url: "javascript:alert('xss')",
    });
    // `href=''` is the collapse shape the `sanitizeUrl` allowlist
    // produces for disallowed schemes — the anchor stays in the DOM
    // (for layout stability) but points nowhere.
    expect(out).toContain("href=''");
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('alert');
  });

  it('strips `data:` URLs from formatSource `href=`', () => {
    const out = formatSource({
      id: 'X',
      name: 'evil',
      url: 'data:text/html,<script>alert(1)</script>',
    });
    expect(out).toContain("href=''");
    expect(out).not.toContain('data:');
    expect(out).not.toContain('<script>');
  });

  it('strips `javascript:` from the PubMed alternativeUrl slot', () => {
    // The PubMed branch interpolates `url` AND `alternativeUrl` into
    // two separate `href=`s — both must be sanitised.
    const out = formatSource({
      id: '1',
      name: 'PubMed',
      url: 'https://pubmed/1',
      alternativeUrl: 'javascript:alert(1)',
    });
    expect(out).toContain("href='https://pubmed/1'");
    // The second anchor should have a collapsed href, not the raw
    // javascript: payload.
    expect(out.match(/href=''/g)?.length).toBe(1);
    expect(out).not.toContain('javascript:');
  });

  it('escapes attribute-breaking quotes inside source URLs', () => {
    const out = formatSource({
      id: 'X',
      url: "https://evil/' onclick='alert(1)",
    });
    // Single quote becomes `&#39;` — payload can no longer close the
    // attribute and inject an on* handler.
    expect(out).not.toMatch(/' onclick='/);
    expect(out).toContain('&#39;');
  });

  it('escapes attribute-breaking quotes inside source id text', () => {
    const out = formatSource({
      id: "'><script>alert(1)</script>",
      url: 'https://ok',
    });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes source.name so it can\'t inject structure', () => {
    const out = formatSource({
      id: '1',
      name: '<img src=x onerror=alert(1)>',
      url: 'https://ok',
    });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes HTML in evidence ECO descriptions (title= attribute)', () => {
    // The ECO registry is bundled, but the same escape pass runs here
    // so a future registry entry containing a quote can't break out of
    // the `title='…'` attribute.
    const out = formatEvidence([
      { code: 'ECO:0000269', source: { id: '1', name: 'PubMed', url: 'u' } },
    ]);
    // The shipped description is ASCII-safe; we assert the escaped form
    // appears rather than a broken attribute boundary.
    expect(out).toMatch(/<li title='[^<>]+'>/);
  });

  it('strips `javascript:` URLs from formatXrefs anchors', () => {
    const out = formatXrefs([
      {
        id: 'X1',
        name: 'DB',
        url: "javascript:alert('xss')",
      },
    ]);
    expect(out).toContain('href=""');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('alert');
  });

  it('escapes xref.name HTML — no `<img onerror>` injection', () => {
    const out = formatXrefs([
      { id: 'X1', name: '<img src=x onerror=alert(1)>', url: 'https://ok' },
    ]);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes xref.id in the URL-less duplicated-name quirk path', () => {
    // The "NAME NAME ID" fallback must still run each field through
    // the escape pass — otherwise a crafted id would land raw.
    const out = formatXrefs([
      { id: "'><script>x</script>", name: 'DB' },
    ]);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('preserves mailto: and relative URLs — allowlist is not over-broad', () => {
    // Regression guard: the allowlist must pass through the schemes
    // upstream data actually uses. If this test fails, the XSS fix has
    // drifted into breaking real data.
    const mail = formatSource({
      id: '1',
      name: 'Contact',
      url: 'mailto:curator@example.org',
    });
    expect(mail).toContain("href='mailto:curator@example.org'");

    const rel = formatSource({ id: '1', name: 'Doc', url: '/path/to/thing' });
    expect(rel).toContain("href='/path/to/thing'");
  });
});
