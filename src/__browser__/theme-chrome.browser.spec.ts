/**
 * Real-DOM pin for what a config `theme.labelColor` paints: the data-row
 * labels only. Group labels take the colour, track labels the derived
 * light tint, and the neutral chrome cells — the navigation label cell
 * and the credits cell — keep their own neutral tokens (tinting them
 * made the theme bleed above and below the rows it describes).
 *
 * The unit specs assert the token *values* `applyTheme` writes; this one
 * exists because jsdom cannot resolve `var()` through the cascade, so
 * only a real engine can confirm those tokens actually reach the cells —
 * the derived text colour that keeps a dark theme readable, and the
 * default chains that let a consumer override a global token anywhere
 * below the document root (see `tokenRef` in styles/tokens.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { mount, unmountAll } from './mount.js';

/** A standalone track row (renders a `.track-label`) next to a group
 * (renders a `.group-label`), so both label kinds are on screen. */
const rows = () => [
    { id: 'solo', kind: 'features', data: 'https://example.org/a.json' },
    {
      id: 'g',
      label: 'Group',
      tracks: [
        { id: 't1', kind: 'features', data: 'https://example.org/b.json' },
      ],
    },
  ];

const CONFIG = { theme: { labelColor: '#e8f5e9' }, rows: rows() };
/** Indigo: dark enough that the shipped near-black body text would be
 *  illegible on it, so the derived white must actually reach the cell. */
const DARK_CONFIG = { theme: { labelColor: '#1a237e' }, rows: rows() };

type El = HTMLElement & { viewerConfig?: unknown; accession?: string };

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const body = url.includes('/proteins/api/proteins/')
        ? { sequence: { sequence: 'MSEQENCE' } }
        : // The default `features-json` adapter expects a top-level array.
          [{ type: 'DOMAIN', start: 1, end: 5 }];
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    })
  );
}

afterEach(() => {
  // Unmount before restoring `fetch`: hooks run last-registered-first,
  // so mount.js's own teardown would otherwise leave live components
  // able to reach the real network.
  unmountAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bg = (el: Element) => getComputedStyle(el).backgroundColor;
const fg = (el: Element) => getComputedStyle(el).color;

/**
 * Mount a config and wait for every label cell to exist. `vars` are set
 * on the host element — one of the places docs/theming.md tells a
 * consumer they may declare a token, and the one that catches a token
 * whose default was substituted at the document root instead of here.
 */
async function mountViewer(config: unknown, vars: Record<string, string> = {}) {
  stubFetch();
  const el = mount<El>('protvista-uniprot', {
    viewerConfig: config,
    accession: 'P05067',
  });
  for (const [name, value] of Object.entries(vars)) {
    el.style.setProperty(name, value);
  }
  const q = (cls: string) =>
    el.querySelector<HTMLElement>(`.${CSS_PREFIX}-${cls}`);
  await vi.waitFor(() => {
    for (const cls of [
      'group-label',
      'track-label',
      'nav-track-label',
      'credits',
    ]) {
      if (!q(cls)) throw new Error(`${cls} not ready`);
    }
  });
  return q;
}

describe('theme.labelColor — which chrome it tints', () => {
  it('tints row labels but leaves the nav label and credits on the surface colour', async () => {
    const q = await mountViewer(CONFIG);

    // Group labels take the theme colour.
    expect(bg(q('group-label')!)).toBe('rgb(232, 245, 233)');
    // Track labels take the derived tint: neither the group colour nor
    // plain white — the hierarchy the default grey/white pair draws.
    const track = bg(q('track-label')!);
    expect(track).not.toBe('rgb(232, 245, 233)');
    expect(track).not.toBe('rgb(255, 255, 255)');
    // The navigation label cell and credits are chrome, not rows: they
    // sit on the (default white) surface colour, untouched by the theme.
    expect(bg(q('nav-track-label')!)).toBe('rgb(255, 255, 255)');
    expect(bg(q('credits')!)).toBe('rgb(255, 255, 255)');
  });

  it('keeps one text colour down the label column', async () => {
    // The split between row labels and neutral chrome is backgrounds
    // only. The label text tokens are always declared, so if these two
    // cells inherited the page's colour instead the column would show
    // two text colours side by side.
    const q = await mountViewer(CONFIG);
    const shipped = 'rgb(34, 34, 34)';
    for (const cls of [
      'group-label',
      'track-label',
      'nav-track-label',
      'credits',
    ]) {
      expect(fg(q(cls)!), cls).toBe(shipped);
    }
  });

  it('lands the derived text colour on the cell, so a dark theme stays readable', async () => {
    const q = await mountViewer(DARK_CONFIG);

    // The group cell is the author's dark indigo, and its text is the
    // white `applyTheme` derived for it — not the near-black body colour
    // the cell would otherwise inherit.
    expect(bg(q('group-label')!)).toBe('rgb(26, 35, 126)');
    expect(fg(q('group-label')!)).toBe('rgb(255, 255, 255)');

    // The track tint is 25% over white, so it stays pale and keeps the
    // dark text: the two surfaces are resolved independently.
    expect(fg(q('track-label')!)).toBe('rgb(34, 34, 34)');
  });
});

/** No `theme:`, so nothing is written inline on the host and the CSS
 *  token path is the only thing painting these cells. */
const UNTHEMED = () => ({ rows: rows() });
const GREEN = 'rgb(0, 128, 0)';

describe('a global token overridden below the document root', () => {
  it('reaches the component tokens that default from it', async () => {
    // The regression this guards: `--protvista-track-label-color`
    // defaults to `var(--protvista-color-text)`. Declared in the root
    // default block, that reference is substituted *at the root*, and
    // the override below — on the host, which docs/theming.md advertises
    // and the per-instance Quick-start recipe relies on — can never
    // reach the cell. The rules carry the default chain instead, so
    // substitution happens here.
    const q = await mountViewer(UNTHEMED(), {
      '--protvista-color-text': GREEN,
    });
    for (const cls of ['group-label', 'track-label', 'credits']) {
      expect(fg(q(cls)!), cls).toBe(GREEN);
    }
  });

  it('still loses to the component token when both are set', async () => {
    const q = await mountViewer(UNTHEMED(), {
      '--protvista-color-text': GREEN,
      '--protvista-track-label-color': 'rgb(0, 0, 255)',
    });
    expect(fg(q('track-label')!)).toBe('rgb(0, 0, 255)');
    expect(fg(q('group-label')!)).toBe(GREEN);
  });
});

describe('the neutral chrome cells', () => {
  it('retint on their own token, leaving the rest of the page alone', async () => {
    // Making the whole column one colour used to mean repainting
    // --protvista-color-surface, which also repaints popovers, tooltips,
    // the customize panel and the datatable.
    const q = await mountViewer(UNTHEMED(), {
      '--protvista-chrome-cell-bg': GREEN,
    });
    expect(bg(q('nav-track-label')!)).toBe(GREEN);
    expect(bg(q('credits')!)).toBe(GREEN);
    // The data rows are not chrome and keep their own tokens.
    expect(bg(q('track-label')!)).toBe('rgb(255, 255, 255)');
  });

  it('follow the global surface when left alone', async () => {
    const q = await mountViewer(UNTHEMED(), {
      '--protvista-color-surface': GREEN,
    });
    expect(bg(q('nav-track-label')!)).toBe(GREEN);
    expect(bg(q('credits')!)).toBe(GREEN);
  });
});
