/**
 * The colour maths behind config theming (`src/styles/color.ts`). The
 * end-to-end behaviour is pinned in `src/__spec__/theme-config.spec.ts`;
 * this covers the pieces directly, including the two that are easy to get
 * quietly wrong — rejecting an unparseable value rather than passing it
 * through, and compositing a translucent colour before measuring it.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  resolveColor,
  resolveColorWithAlpha,
  mix,
  tint,
  cssRgb,
  cssRgba,
  relativeLuminance,
  contrastRatio,
  readableOn,
  defaultTextColor,
  TEXT_ON_DARK,
  TRACK_LABEL_TINT,
} from '../color.js';

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

describe('resolveColor', () => {
  it('accepts the CSS colour syntaxes an author is likely to write', () => {
    expect(resolveColor('#e8f5e9')).toEqual({ r: 232, g: 245, b: 233 });
    expect(resolveColor('#fff')).toEqual(WHITE);
    expect(resolveColor('green')).toEqual({ r: 0, g: 128, b: 0 });
    expect(resolveColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(resolveColor('hsl(120, 50%, 50%)')).toEqual({
      r: 64,
      g: 191,
      b: 64,
    });
  });

  it('rejects anything the browser cannot parse as a colour', () => {
    // The last two matter beyond typos: a config value is author-supplied,
    // and refusing to resolve is what stops it reaching the stylesheet as
    // written.
    expect(resolveColor('')).toBeNull();
    expect(resolveColor('not-a-colour')).toBeNull();
    expect(resolveColor('red; background: url(https://example.org/x)')).toBeNull();
    expect(resolveColor('white), url(https://example.org/x')).toBeNull();
  });

  it('composites a translucent colour over the surface', () => {
    // Half-opacity black over white is mid-grey — the colour the eye
    // actually sees, and so the one contrast has to be measured against.
    expect(resolveColor('rgba(0, 0, 0, 0.5)')).toEqual({
      r: 128,
      g: 128,
      b: 128,
    });
    expect(resolveColor('transparent')).toEqual(WHITE);
  });

  it('rejects CSS-wide keywords and var() references', () => {
    // Each of these parses as a valid `color` declaration, so the CSSOM
    // "did that stick?" test accepts them — but none names a colour, and
    // resolving one would silently hand back whatever the probe element
    // happened to inherit.
    for (const value of [
      'inherit',
      'initial',
      'unset',
      'revert',
      'revert-layer',
      'INHERIT',
      'var(--some-page-token)',
    ]) {
      expect(resolveColor(value), value).toBeNull();
    }
  });
});

describe('resolveColor — CIE and Oklab syntaxes', () => {
  // Converted in this module rather than delegated to the browser: Safari
  // 15 is inside the documented support matrix and cannot parse oklch()
  // at all, so delegating would drop an author's colour there. jsdom
  // cannot parse them either, which is why these assertions pass under
  // the unit project at all.
  const RED = { r: 255, g: 0, b: 0 };

  it('converts the polar forms', () => {
    expect(resolveColor('oklch(0.62796 0.25768 29.234)')).toEqual(RED);
    expect(resolveColor('lch(54.29 105.6 40.85)')).toEqual({
      r: 254,
      g: 10,
      b: 2,
    });
  });

  it('converts the rectangular forms', () => {
    expect(resolveColor('oklab(0.62796 0.22486 0.12585)')).toEqual(RED);
    expect(resolveColor('lab(54.29 80.81 69.89)')).toEqual(RED);
    // The reference neutral: CIE L*=50 is the mid grey #777777.
    expect(resolveColor('lab(50 0 0)')).toEqual({ r: 119, g: 119, b: 119 });
    expect(resolveColor('lab(100 0 0)')).toEqual(WHITE);
  });

  it('accepts percentages, none, and the alternative angle units', () => {
    // 100% is the reference range of each channel: 1 for Oklab lightness,
    // 0.4 for Oklab chroma. `none` is zero once a colour is used rather
    // than interpolated.
    expect(resolveColor('oklch(50% 0% 0deg)')).toEqual(
      resolveColor('oklch(0.5 0 0)')
    );
    expect(resolveColor('oklch(0.5 none none)')).toEqual(
      resolveColor('oklch(0.5 0 0)')
    );
    // 0.5turn, 200grad and π rad are all 180°.
    const half = resolveColor('oklch(0.7 0.1 180deg)');
    for (const hue of ['0.5turn', '200grad', '3.14159265rad']) {
      expect(resolveColor(`oklch(0.7 0.1 ${hue})`), hue).toEqual(half);
    }
  });

  it('converts the predefined colour spaces color() can name', () => {
    expect(resolveColor('color(srgb 0 0.5 0)')).toEqual({
      r: 0,
      g: 128,
      b: 0,
    });
    // The P3 neutral axis is the sRGB neutral axis.
    expect(resolveColor('color(display-p3 0.5 0.5 0.5)')).toEqual({
      r: 128,
      g: 128,
      b: 128,
    });
    expect(resolveColor('color(srgb-linear 1 1 1)')).toEqual(WHITE);
    // A space we cannot bring back to sRGB is rejected, not guessed at.
    expect(resolveColor('color(rec2020 1 0 0)')).toBeNull();
  });

  it('clamps a colour outside the sRGB gamut per channel', () => {
    // Display P3 red is more saturated than sRGB can represent; clamping
    // lands on the nearest sRGB colour rather than dropping the value.
    expect(resolveColor('color(display-p3 1 0 0)')).toEqual(RED);
    // Likewise a chroma no sRGB colour reaches.
    const shouted = resolveColor('oklch(0.62796 0.9 29.234)')!;
    for (const channel of ['r', 'g', 'b'] as const) {
      expect(shouted[channel]).toBeGreaterThanOrEqual(0);
      expect(shouted[channel]).toBeLessThanOrEqual(255);
    }
  });

  it('rejects a malformed modern colour rather than half-parsing it', () => {
    for (const value of [
      'oklch(0.5 0.1)',
      'oklch(0.5 0.1 20 30)',
      'oklch(0.5 0.1 nonsense)',
      'lab(fifty 0 0)',
      'color(srgb 1 0)',
    ]) {
      expect(resolveColor(value), value).toBeNull();
    }
  });
});

describe('alpha', () => {
  it('keeps alpha where it is asked for, and composites where it is not', () => {
    expect(resolveColorWithAlpha('rgba(0, 0, 0, 0.5)')).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0.5,
    });
    expect(resolveColorWithAlpha('oklch(0.62796 0.25768 29.234 / 40%)')).toEqual(
      { r: 255, g: 0, b: 0, a: 0.4 }
    );
    // The opaque form is what contrast is measured against.
    expect(resolveColor('rgba(0, 0, 0, 0.5)')).toEqual({
      r: 128,
      g: 128,
      b: 128,
    });
  });

  it('serialises alpha only when there is any to keep', () => {
    expect(cssRgba({ r: 1, g: 2, b: 3, a: 1 })).toBe('rgb(1, 2, 3)');
    expect(cssRgba({ r: 1, g: 2, b: 3, a: 0.5 })).toBe('rgba(1, 2, 3, 0.5)');
  });
});

describe('mixing', () => {
  it('weights the first colour and rounds to whole channels', () => {
    expect(mix(BLACK, WHITE, 0.5)).toEqual({ r: 128, g: 128, b: 128 });
    expect(mix(BLACK, WHITE, 1)).toEqual(BLACK);
    expect(mix(BLACK, WHITE, 0)).toEqual(WHITE);
  });

  it('tints toward the surface, keeping the track label the paler half', () => {
    const base = resolveColor('#1a237e')!;
    const tinted = tint(base, TRACK_LABEL_TINT);
    expect(relativeLuminance(tinted)).toBeGreaterThan(relativeLuminance(base));
    // Even a very dark label colour tints to something pale.
    expect(contrastRatio(tinted, defaultTextColor())).toBeGreaterThan(4.5);
  });

  it('serialises as a literal every supported browser parses', () => {
    expect(cssRgb({ r: 1, g: 2, b: 3 })).toBe('rgb(1, 2, 3)');
  });
});

describe('contrast', () => {
  it('matches the WCAG reference values at the extremes', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 2);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('is symmetric in its arguments', () => {
    const a = resolveColor('#1a237e')!;
    const b = resolveColor('#e8f5e9')!;
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it('picks whichever candidate reads better on the background', () => {
    const candidates: [typeof WHITE, typeof WHITE] = [
      defaultTextColor(),
      TEXT_ON_DARK,
    ];
    expect(readableOn(resolveColor('#1a237e')!, candidates)).toEqual(
      TEXT_ON_DARK
    );
    expect(readableOn(resolveColor('#e8f5e9')!, candidates)).toEqual(
      defaultTextColor()
    );
  });
});

describe('defaultTextColor', () => {
  it('is the registry value for --protvista-color-text', () => {
    // Read from TOKENS rather than hardcoded, so the text candidate can
    // never drift from the token whose job it is doing.
    expect(defaultTextColor()).toEqual({ r: 0x22, g: 0x22, b: 0x22 });
  });

  it('is not pinned by a call made before there is a DOM', async () => {
    // The DOM-less fallback must not be cached: one early call would
    // otherwise fix the wrong colour for the lifetime of the page, which
    // is exactly the drift that reading from the registry prevents.
    // The registry is stubbed with a colour that is *not* the fallback,
    // because the two are equal in the shipped values — so only a
    // different one can tell "consulted the registry" from "kept the
    // fallback".
    vi.resetModules();
    vi.doMock('../tokens.js', () => ({
      TOKENS: [
        {
          name: '--protvista-color-text',
          group: 'global',
          type: 'color',
          default: '#ff0000',
          description: 'stubbed for this test',
        },
      ],
    }));
    const realDocument = globalThis.document;
    let fresh: typeof import('../color.js');
    Reflect.deleteProperty(globalThis, 'document');
    try {
      fresh = await import('../color.js');
      // Nothing to resolve against: the hardcoded fallback.
      expect(fresh.defaultTextColor()).toEqual({ r: 0x22, g: 0x22, b: 0x22 });
    } finally {
      Object.defineProperty(globalThis, 'document', {
        value: realDocument,
        configurable: true,
        writable: true,
      });
    }
    // With a DOM the registry is consulted again rather than the earlier
    // fallback being handed back.
    expect(fresh.defaultTextColor()).toEqual({ r: 255, g: 0, b: 0 });
    vi.doUnmock('../tokens.js');
    vi.resetModules();
  });
});
