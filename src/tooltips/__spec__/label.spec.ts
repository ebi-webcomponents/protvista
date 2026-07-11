/**
 * Coverage for `renderLabel` — the group / track `label` Markdoc pipeline.
 *
 * `label` is a single-line, inline-only Markdoc surface: plain Markdown
 * (emphasis, code, links) plus the `{% help slug="…" %}…{% /help %}` custom
 * tag, with `{accession}` substituted before parsing. This suite pins:
 *
 *   - plain text renders as bare text (no `<p>` / `<article>` wrapper);
 *   - inline formatting (`strong` / `em` / `code`);
 *   - the `{% help %}` tag → `<span data-article-id="…">` (uniprot.org's
 *     in-page help-popover DOM), including its slug allowlist;
 *   - label links get the same `sanitizeUrl` / external-link treatment as
 *     tooltip links (mirrors the URL-allowlist cases in `resolve.spec.ts`);
 *   - `{accession}` pre-parse substitution;
 *   - block-level markup degrades to inline text and warns.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderLabel } from '../resolve';

function htmlFragment(html: string): HTMLDivElement {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const div = document.createElement('div');
  div.append(...Array.from(doc.body.childNodes));
  return div;
}

describe('renderLabel — plain + inline formatting', () => {
  it('renders plain text as bare text (no <p> / <article> wrapper)', () => {
    expect(renderLabel('Signal peptide')).toBe('Signal peptide');
  });

  it('returns the empty string for an empty source', () => {
    expect(renderLabel('')).toBe('');
  });

  it('renders inline emphasis, strong, and code spans', () => {
    expect(renderLabel('**Bold**')).toBe('<strong>Bold</strong>');
    expect(renderLabel('_Emphasis_')).toBe('<em>Emphasis</em>');
    expect(renderLabel('`code`')).toBe('<code>code</code>');
  });

  it('does not wrap a single-line label in a block element', () => {
    const out = renderLabel('Just a label');
    expect(out).not.toContain('<p>');
    expect(out).not.toContain('<article>');
  });
});

describe('renderLabel — {% help %} tag', () => {
  it('emits <span data-article-id="slug"> for a valid slug', () => {
    expect(renderLabel('{% help slug="signal" %}Signal peptide{% /help %}')).toBe(
      '<span data-article-id="signal">Signal peptide</span>'
    );
  });

  it('accepts hash-bearing slugs like the real proteomics help id', () => {
    const out = renderLabel(
      '{% help slug="proteomics#1-data-from-public-mass-spectrometry" %}Proteomics{% /help %}'
    );
    const span = htmlFragment(out).querySelector('span');
    expect(span?.getAttribute('data-article-id')).toBe(
      'proteomics#1-data-from-public-mass-spectrometry'
    );
    expect(span?.textContent).toBe('Proteomics');
  });

  it('degrades a slug with an out-of-charset character to a plain <span>', () => {
    // A space is outside `^[a-zA-Z0-9_#-]+$` — the transform drops the
    // attribute rather than emit a bogus data-article-id.
    const out = renderLabel('{% help slug="bad slug" %}Text{% /help %}');
    const span = htmlFragment(out).querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.hasAttribute('data-article-id')).toBe(false);
    expect(span?.textContent).toBe('Text');
  });
});

describe('renderLabel — links', () => {
  it('opens external http(s) links in a new tab with rel=noopener', () => {
    const out = renderLabel(
      '[AlphaFold](https://alphafold.ebi.ac.uk/entry/{accession})',
      'P05067'
    );
    const link = htmlFragment(out).querySelector('a');
    expect(link?.getAttribute('href')).toBe(
      'https://alphafold.ebi.ac.uk/entry/P05067'
    );
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.textContent).toBe('AlphaFold');
  });

  it('keeps relative / in-page links in the same tab (no target)', () => {
    const link = htmlFragment(renderLabel('[Help](#anchor)')).querySelector('a');
    expect(link?.getAttribute('href')).toBe('#anchor');
    expect(link?.hasAttribute('target')).toBe(false);
  });

  it('strips a link whose scheme is outside the http/https/mailto allowlist', () => {
    // Markdoc linkifies `scheme://…` destinations; `sanitizeUrl` then blocks
    // any scheme it doesn't allow (here `ftp:`), leaving an empty href —
    // the same URL boundary tooltip links go through.
    const out = renderLabel('[x](ftp://ok.example/file)');
    const link = htmlFragment(out).querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('');
    expect(out).not.toContain('ftp://');
  });
});

describe('renderLabel — {accession} substitution', () => {
  it('substitutes {accession} before parsing when supplied', () => {
    expect(renderLabel('Entry {accession}', 'P05067')).toBe('Entry P05067');
  });

  it('leaves {accession} literal when no accession is supplied', () => {
    expect(renderLabel('Entry {accession}')).toBe('Entry {accession}');
  });
});

describe('renderLabel — block markup is not supported', () => {
  it('degrades a heading to inline text and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const out = renderLabel('# Heading text');
    expect(out).not.toContain('<h1>');
    expect(out).toContain('Heading text');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('degrades a list to inline text and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const out = renderLabel('- one\n- two');
    expect(out).not.toContain('<ul>');
    expect(out).not.toContain('<li>');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
