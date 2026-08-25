/**
 * The colour maths behind config theming (`src/styles/color.ts`). The
 * end-to-end behaviour is pinned in `src/__spec__/theme-config.spec.ts`;
 * this covers the pieces directly, including the two that are easy to get
 * quietly wrong — rejecting an unparseable value rather than passing it
 * through, and compositing a translucent colour before measuring it.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveColor,
  mix,
  tint,
  cssRgb,
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
});
