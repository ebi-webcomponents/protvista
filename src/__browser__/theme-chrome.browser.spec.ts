/**
 * Real-DOM pin for what a config `theme.labelColor` paints: the data-row
 * labels only. Group labels take the colour, track labels the derived
 * light tint, and the neutral chrome cells — the navigation label cell
 * and the credits cell — stay on the plain surface colour (tinting them
 * made the theme bleed above and below the rows it describes).
 *
 * The unit specs assert the token *values* `applyTheme` writes; this one
 * exists because jsdom cannot resolve `var()` through the cascade, so
 * only a real engine can confirm those tokens actually reach the cells —
 * including the derived text colour that keeps a dark theme readable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import '../protvista-uniprot.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';
import { mount } from './mount.js';

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bg = (el: Element) => getComputedStyle(el).backgroundColor;
const fg = (el: Element) => getComputedStyle(el).color;

/** Mount a config and wait for every label cell to exist. */
async function mountViewer(config: unknown) {
  stubFetch();
  const el = mount<El>('protvista-uniprot', {
    viewerConfig: config,
    accession: 'P05067',
  });
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
