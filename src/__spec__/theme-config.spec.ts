/**
 * Config-driven theming: a top-level `theme:` block is applied by the
 * component as inline `--protvista-*` custom properties on the host at
 * mount (see `applyTheme` in protvista-uniprot.ts).
 *
 * The config carries inline track data (no network) and `loadEntry` is
 * stubbed to a never-resolving promise, so `_init()` reaches `applyTheme`
 * (which runs before the fire-and-forget sequence fetch) and resolves
 * without touching the network.
 */
import { describe, it, expect } from 'vitest';
// Registers the <protvista-uniprot> element (side-effect import).
import '../protvista-uniprot.js';
import { contrastRatio, resolveColor, type Rgb } from '../styles/color.js';

type TestableElement = HTMLElement & {
  viewerConfig?: unknown;
  loadEntry: (...args: unknown[]) => Promise<unknown>;
  _init: () => Promise<void>;
  applyTheme: (theme: unknown) => void;
};

const mount = (config: unknown): TestableElement => {
  const el = document.createElement('protvista-uniprot') as TestableElement;
  // Avoid the background sequence fetch — applyTheme runs before it.
  el.loadEntry = () => new Promise(() => {});
  el.viewerConfig = config;
  return el;
};

const inlineTrack = {
  id: 'X',
  tracks: [
    { id: 't', kind: 'features', data: { from: 'inline', inlineData: [] } },
  ],
};

/** Read a token off the host and parse it back into channels. */
const token = (el: HTMLElement, name: string): string =>
  el.style.getPropertyValue(name);
const tokenRgb = (el: HTMLElement, name: string): Rgb => {
  const value = token(el, name);
  const rgb = resolveColor(value);
  if (!rgb) throw new Error(`${name} is not a resolvable colour: "${value}"`);
  return rgb;
};

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NEAR_BLACK: Rgb = { r: 34, g: 34, b: 34 };
/** WCAG 1.4.3 AA for body text. */
const AA = 4.5;

describe('config theme → chrome tokens on the host', () => {
  it('maps theme.labelColor + accentColor to inline --protvista-* properties', async () => {
    const el = mount({
      accession: 'P05067',
      theme: { labelColor: '#e8f5e9', accentColor: '#008000' },
      rows: [inlineTrack],
    });
    await el._init();
    // labelColor lands on group labels; track labels get a derived light
    // tint, so the group-vs-track hierarchy survives one-knob theming.
    // Both are emitted as resolved rgb() rather than the authored string:
    // the derived text/hover/caret values come from the same numbers, and
    // a plain rgb() literal parses in every supported browser.
    expect(token(el, '--protvista-group-label-bg')).toBe('rgb(232, 245, 233)');
    expect(token(el, '--protvista-track-label-bg')).toBe('rgb(249, 253, 250)');
    expect(token(el, '--protvista-color-accent')).toBe('rgb(0, 128, 0)');
  });

  it('lets groupLabelColor/trackLabelColor override the labelColor pair', async () => {
    const el = mount({
      accession: 'P05067',
      theme: {
        labelColor: '#e8f5e9',
        groupLabelColor: '#c8e6c9',
        trackLabelColor: '#fbfffb',
      },
      rows: [inlineTrack],
    });
    await el._init();
    expect(token(el, '--protvista-group-label-bg')).toBe('rgb(200, 230, 201)');
    expect(token(el, '--protvista-track-label-bg')).toBe('rgb(251, 255, 251)');
  });

  it('applies an explicit per-surface colour on its own (no labelColor)', async () => {
    const el = mount({
      accession: 'P05067',
      theme: { trackLabelColor: '#fbfffb' },
      rows: [inlineTrack],
    });
    await el._init();
    expect(token(el, '--protvista-track-label-bg')).toBe('rgb(251, 255, 251)');
    // No labelColor and no group override: the group tokens stay unset.
    expect(token(el, '--protvista-group-label-bg')).toBe('');
    expect(token(el, '--protvista-group-label-color')).toBe('');
  });

  it('applies only the fields present (accentColor alone)', async () => {
    const el = mount({
      accession: 'P05067',
      theme: { accentColor: '#008000' },
      rows: [inlineTrack],
    });
    await el._init();
    expect(token(el, '--protvista-color-accent')).toBe('rgb(0, 128, 0)');
    expect(token(el, '--protvista-group-label-bg')).toBe('');
  });

  it('leaves the tokens untouched when the config has no theme', async () => {
    const el = mount({ accession: 'P05067', rows: [inlineTrack] });
    await el._init();
    expect(token(el, '--protvista-group-label-bg')).toBe('');
    expect(token(el, '--protvista-color-accent')).toBe('');
  });

  it('drops a colour the browser cannot parse rather than emitting it', async () => {
    const el = mount({
      accession: 'P05067',
      theme: { labelColor: 'not-a-colour; background: red' },
      rows: [inlineTrack],
    });
    await el._init();
    expect(token(el, '--protvista-group-label-bg')).toBe('');
    expect(token(el, '--protvista-group-label-color')).toBe('');
  });

  it('ignores an unresolvable override and falls back to labelColor', async () => {
    const el = mount({
      accession: 'P05067',
      theme: { labelColor: '#e8f5e9', groupLabelColor: 'not-a-colour' },
      rows: [inlineTrack],
    });
    await el._init();
    // The bad field drops out as though it had not been written, rather
    // than taking the group surface down with it.
    expect(token(el, '--protvista-group-label-bg')).toBe('rgb(232, 245, 233)');
    expect(token(el, '--protvista-track-label-bg')).toBe('rgb(249, 253, 250)');
  });

  it('clears previously-set tokens on re-apply with a narrowed or removed theme', async () => {
    const el = mount({
      accession: 'P05067',
      theme: { labelColor: '#1a237e', accentColor: '#008000' },
      rows: [inlineTrack],
    });
    await el._init();
    expect(token(el, '--protvista-group-label-bg')).toBe('rgb(26, 35, 126)');
    expect(token(el, '--protvista-group-label-color')).not.toBe('');

    // Narrow the theme (drop labelColor): the stale label tokens must
    // clear — including the *derived* ones, or a white text colour picked
    // for a dark label would outlive the label that justified it.
    el.applyTheme({ accentColor: '#123456' });
    for (const name of [
      '--protvista-group-label-bg',
      '--protvista-group-label-color',
      '--protvista-group-label-color-muted',
      '--protvista-group-label-hover-bg',
      '--protvista-track-label-bg',
      '--protvista-track-label-color',
      '--protvista-track-label-color-muted',
      '--protvista-caret-color',
    ]) {
      expect(token(el, name), name).toBe('');
    }
    expect(token(el, '--protvista-color-accent')).toBe('rgb(18, 52, 86)');

    // Remove the theme entirely: all managed tokens clear.
    el.applyTheme(undefined);
    expect(token(el, '--protvista-color-accent')).toBe('');
  });
});

describe('a themed label stays legible', () => {
  it('keeps the near-black body text on a pale label', async () => {
    const el = mount({
      accession: 'P05067',
      theme: { labelColor: '#e8f5e9' },
      rows: [inlineTrack],
    });
    await el._init();
    expect(tokenRgb(el, '--protvista-group-label-color')).toEqual(NEAR_BLACK);
    expect(tokenRgb(el, '--protvista-track-label-color')).toEqual(NEAR_BLACK);
  });

  it('flips label text to white on a dark labelColor', async () => {
    // Indigo: the case that used to render near-black on near-black.
    const el = mount({
      accession: 'P05067',
      theme: { labelColor: '#1a237e' },
      rows: [inlineTrack],
    });
    await el._init();
    expect(tokenRgb(el, '--protvista-group-label-color')).toEqual(WHITE);
    // The derived track tint is 25% over white, so it stays pale — and so
    // keeps the dark text. The pair must not flip together.
    expect(tokenRgb(el, '--protvista-track-label-color')).toEqual(NEAR_BLACK);
  });

  it('clears AA on both label surfaces across light and dark themes', async () => {
    // #767676 is close to the worst-case grey that still clears AA
    // (white text reaches ~4.55:1). Mid-tones beyond it cannot reach AA
    // with any text — pinned separately below, and the docs carry the
    // matching caveat.
    for (const labelColor of ['#e8f5e9', '#1a237e', '#767676', '#ffffff']) {
      const el = mount({
        accession: 'P05067',
        theme: { labelColor },
        rows: [inlineTrack],
      });
      await el._init();
      for (const surface of ['group', 'track']) {
        const bg = tokenRgb(el, `--protvista-${surface}-label-bg`);
        const fg = tokenRgb(el, `--protvista-${surface}-label-color`);
        expect(
          contrastRatio(bg, fg),
          `${surface} label on ${labelColor}`
        ).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('picks the better candidate on a mid-grey that cannot reach AA', async () => {
    // #808080 sits too close to both black and white for any text to
    // clear 4.5:1 (white manages ~3.9:1, near-black ~4.0:1). What is
    // guaranteed here is readableOn's actual contract — the better of
    // the two candidates, never worse than shipping the default — not
    // AA itself.
    const el = mount({
      accession: 'P05067',
      theme: { labelColor: '#808080' },
      rows: [inlineTrack],
    });
    await el._init();
    const bg = tokenRgb(el, '--protvista-group-label-bg');
    const fg = tokenRgb(el, '--protvista-group-label-color');
    const best = Math.max(
      contrastRatio(bg, NEAR_BLACK),
      contrastRatio(bg, WHITE)
    );
    expect(contrastRatio(bg, fg)).toBe(best);
    // The docs' caveat is real: AA is out of reach on this grey.
    expect(best).toBeLessThan(AA);
  });

  it('keeps the caret and hover state on the dark label readable', async () => {
    const el = mount({
      accession: 'P05067',
      theme: { labelColor: '#1a237e' },
      rows: [inlineTrack],
    });
    await el._init();
    const bg = tokenRgb(el, '--protvista-group-label-bg');
    const hover = tokenRgb(el, '--protvista-group-label-hover-bg');
    const text = tokenRgb(el, '--protvista-group-label-color');

    // The hover cue is visible but small enough that the white text
    // chosen for the resting state still clears AA on it — the global
    // near-white hover would have erased the label instead.
    expect(hover).not.toEqual(bg);
    expect(contrastRatio(hover, text)).toBeGreaterThanOrEqual(AA);

    // The caret is a UI affordance: 3:1 against its own cell (WCAG 1.4.11).
    const caret = tokenRgb(el, '--protvista-caret-color');
    expect(contrastRatio(bg, caret)).toBeGreaterThanOrEqual(3);
    // Muted text is recessive but still readable.
    const muted = tokenRgb(el, '--protvista-group-label-color-muted');
    expect(contrastRatio(bg, muted)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(bg, muted)).toBeLessThan(contrastRatio(bg, text));
  });

  it('reproduces the shipped muted grey when the theme is a white label', async () => {
    // #4a5056 over white is what an unthemed viewer mutes to; a theme that
    // happens to pick white must not visibly change it.
    const el = mount({
      accession: 'P05067',
      theme: { trackLabelColor: '#ffffff' },
      rows: [inlineTrack],
    });
    await el._init();
    const muted = tokenRgb(el, '--protvista-track-label-color-muted');
    const shipped = resolveColor('#4a5056')!;
    // mix(#222, white, 0.8) = rgb(78, 78, 78); shipped is #4a5056 — the
    // largest channel delta is 8 (blue: 86 vs 78).
    for (const channel of ['r', 'g', 'b'] as const) {
      expect(Math.abs(muted[channel] - shipped[channel])).toBeLessThanOrEqual(8);
    }
  });
});
