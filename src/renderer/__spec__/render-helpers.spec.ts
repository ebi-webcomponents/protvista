/**
 * Unit tests for `src/renderer/render-helpers.ts`.
 *
 * These helpers are the one place where the normalize pipeline's
 * structured `RenderingOptions` (with a nested `colorScale: { theme |
 * stops }`) is flattened onto the plain-string attribute shape
 * Nightingale's web components consume (`color`, `shape`, `scale`,
 * `color-range`). Any drift in the flattening is a silent visual bug
 * — the renderer won't log a warning, the coloured-sequence strip
 * just comes out different.
 *
 * The two built-in theme expansions are byte-for-byte parity targets
 * with the pre-schema `src/config.ts` — losing a stop or flipping a
 * decimal is a rendering regression. Those literal strings live here
 * (and in `render-helpers.ts`) on purpose, duplicated verbatim, so a
 * mismatch surfaces the full diff rather than a cryptic attribute-
 * value change.
 */
import { describe, it, expect } from 'vitest';

import {
  colorScaleToAttrs,
  colorScaleToColorFn,
  renderingToAttrs,
} from '../render-helpers.js';

describe('colorScaleToAttrs', () => {
  it('returns `{}` for undefined input (no rendering work to do)', () => {
    expect(colorScaleToAttrs(undefined)).toEqual({});
  });

  it('returns `{}` for an empty object (no theme, no stops)', () => {
    expect(colorScaleToAttrs({})).toEqual({});
  });

  it('expands the alphafold-ramp theme to the legacy scale / color-range pair', () => {
    expect(colorScaleToAttrs({ theme: 'alphafold-ramp' })).toEqual({
      scale: 'H:90,M:70,L:50,D:0',
      colorRange:
        '#ff7d45:0,#ffdb13:50,#65cbf3:70,#0053d6:90,#0053d6:100',
    });
  });

  it('expands the alphamissense-ramp theme to the legacy scale / color-range pair', () => {
    expect(colorScaleToAttrs({ theme: 'alphamissense-ramp' })).toEqual({
      scale:
        '-:-1,B:0,H:0.1132,V:0.2264,L:0.3395,A:0.4527,l:0.5895,h:0.7264,p:0.8632,P:1',
      colorRange:
        'transparent:-1,#2166ac:0,#4290bf:0.1132,#8cbcd4:0.2264,#c3d6e0:0.3395,#e2e2e2:0.4527,#edcdba:0.5895,#e99e7c:0.7264,#d15e4b:0.8632,#b2182b:1',
    });
  });

  it('synthesises color-range from explicit stops (no scale emitted)', () => {
    expect(
      colorScaleToAttrs({
        stops: [
          { value: 0, color: '#000000' },
          { value: 0.5, color: '#808080' },
          { value: 1, color: '#ffffff' },
        ],
      })
    ).toEqual({
      colorRange: '#000000:0,#808080:0.5,#ffffff:1',
    });
  });

  it('prefers explicit stops over a theme when both are present', () => {
    // Matches the schema's documented precedence: "explicit stops
    // take precedence over theme", useful for "start from a named
    // theme and override a single stop".
    expect(
      colorScaleToAttrs({
        theme: 'alphafold-ramp',
        stops: [{ value: 0, color: '#123456' }],
      })
    ).toEqual({ colorRange: '#123456:0' });
  });

  it('emits nothing for an unknown theme without stops', () => {
    // Authors registering a custom theme won't hit the built-in map
    // — the fallthrough returns `{}` so the coloured-sequence strip
    // renders with no scale/range attributes rather than wedging on
    // a stale lookup.
    expect(colorScaleToAttrs({ theme: 'custom-theme-not-registered' })).toEqual(
      {}
    );
  });

  it('treats an empty stops array as "no stops" and falls through to the theme branch', () => {
    // `cs.stops.length > 0` is the guard; an empty array should not
    // mask a valid theme.
    expect(
      colorScaleToAttrs({ theme: 'alphafold-ramp', stops: [] })
    ).toEqual({
      scale: 'H:90,M:70,L:50,D:0',
      colorRange:
        '#ff7d45:0,#ffdb13:50,#65cbf3:70,#0053d6:90,#0053d6:100',
    });
  });
});

describe('colorScaleToColorFn', () => {
  it('returns undefined when there is no colour scale to resolve', () => {
    expect(colorScaleToColorFn(undefined)).toBeUndefined();
    expect(colorScaleToColorFn({})).toBeUndefined();
    expect(colorScaleToColorFn({ theme: 'not-registered' })).toBeUndefined();
  });

  it('draws alphamissense-ramp exactly as the d3 amColorScale it replaces', () => {
    // Reference values from nightingale-structure's `amColorScale` (a d3
    // `scaleLinear` over the same nine stops), including extrapolation past
    // both ends and `undefined` for a missing score.
    const fn = colorScaleToColorFn({ theme: 'alphamissense-ramp' })!;
    const expected: Array<[number, string]> = [
      [-0.5, 'rgb(0, 0, 88)'],
      [0, 'rgb(33, 102, 172)'],
      [0.05, 'rgb(48, 121, 180)'],
      [0.1132, 'rgb(66, 144, 191)'],
      [0.2, 'rgb(123, 178, 207)'],
      [0.3, 'rgb(176, 205, 220)'],
      [0.4527, 'rgb(226, 226, 226)'],
      [0.5, 'rgb(230, 219, 212)'],
      [0.6, 'rgb(237, 201, 181)'],
      [0.75, 'rgb(229, 147, 116)'],
      [0.9, 'rgb(201, 75, 66)'],
      [1, 'rgb(178, 24, 43)'],
      [1.5, 'rgb(65, 0, 0)'],
    ];
    for (const [score, color] of expected) expect(fn(score)).toBe(color);
    expect(fn(NaN)).toBeUndefined();
    expect(fn(undefined as unknown as number)).toBeUndefined();
  });

  it('interpolates explicit stops, which win over the theme', () => {
    const fn = colorScaleToColorFn({
      theme: 'alphamissense-ramp',
      stops: [
        { value: 1, color: '#fff' },
        { value: 0, color: '#000000' },
      ],
    })!;
    expect(fn(0)).toBe('rgb(0, 0, 0)');
    expect(fn(0.5)).toBe('rgb(128, 128, 128)');
    expect(fn(1)).toBe('rgb(255, 255, 255)');
  });

  it('looks a registered theme up through getTheme', () => {
    const fn = colorScaleToColorFn({ theme: 'mine' }, (name) =>
      name === 'mine'
        ? [
            { value: 0, color: '#ff0000' },
            { value: 10, color: '#0000ff' },
          ]
        : undefined
    )!;
    expect(fn(5)).toBe('rgb(128, 0, 128)');
  });

  // ColorStop.color takes any CSS colour, and the coloured sequence hands the
  // same stops to a d3 scaleLinear, which interpolates all of these. Each
  // expected value is what `scaleLinear().domain([0, 1]).range([lo, hi])`
  // returns.
  const nonHex: Array<[string, string, string, Array<[number, string]>]> = [
    [
      'named',
      'blue',
      'red',
      [
        [0.5, 'rgb(128, 0, 128)'],
        [0.25, 'rgb(64, 0, 191)'],
        [-1, 'rgb(0, 0, 255)'],
        [2, 'rgb(255, 0, 0)'],
      ],
    ],
    ['black / white', 'black', 'white', [[0.5, 'rgb(128, 128, 128)']]],
    ['rgb()', 'rgb(0, 0, 255)', 'rgb(255, 0, 0)', [[0.5, 'rgb(128, 0, 128)']]],
    ['#rrggbbaa', '#0000ffff', '#ff0000ff', [[0.5, 'rgb(128, 0, 128)']]],
    [
      'rgba() below full opacity',
      'rgba(0, 0, 255, 0.5)',
      'rgba(255, 0, 0, 1)',
      [[0.5, 'rgba(128, 0, 128, 0.75)']],
    ],
    [
      'rgb() percentages',
      'rgb(0%, 0%, 100%)',
      'rgb(100%, 0%, 0%)',
      [[0.5, 'rgb(128, 0, 128)']],
    ],
    [
      'hsl()',
      'hsl(240, 100%, 50%)',
      'hsl(0, 100%, 50%)',
      [[0.5, 'rgb(128, 0, 128)']],
    ],
    [
      'transparent',
      'transparent',
      'red',
      [
        [0.5, 'rgba(255, 0, 0, 0.5)'],
        [1, 'rgb(255, 0, 0)'],
      ],
    ],
    [
      '#rgba',
      '#00f8',
      '#f00f',
      [[0.5, 'rgba(128, 0, 128, 0.7666666666666666)']],
    ],
    [
      'hsla() to a named colour, extrapolated',
      'hsla(120, 50%, 25%, 0.3)',
      'goldenrod',
      [
        [0, 'rgba(32, 96, 32, 0.3)'],
        [0.3, 'rgba(88, 116, 32, 0.51)'],
        [1.7, 'rgb(255, 214, 32)'],
      ],
    ],
  ];
  for (const [label, lo, hi, expected] of nonHex) {
    it(`interpolates ${label} stops as d3 scaleLinear does`, () => {
      const fn = colorScaleToColorFn({
        stops: [
          { value: 0, color: lo },
          { value: 1, color: hi },
        ],
      })!;
      for (const [score, color] of expected) expect(fn(score)).toBe(color);
    });
  }

  it('steps between stops no CSS colour parser can read', () => {
    const fn = colorScaleToColorFn({
      stops: [
        { value: 0, color: 'var(--low)' },
        { value: 1, color: 'blue' },
      ],
    })!;
    expect(fn(-1)).toBe('var(--low)');
    expect(fn(0.5)).toBe('var(--low)');
    expect(fn(1)).toBe('blue');
  });
});

describe('renderingToAttrs', () => {
  it('returns `{}` for an empty RenderingOptions', () => {
    expect(renderingToAttrs({})).toEqual({});
  });

  it('passes `color` and `shape` through unchanged', () => {
    expect(renderingToAttrs({ color: '#ff0000', shape: 'diamond' })).toEqual({
      color: '#ff0000',
      shape: 'diamond',
    });
  });

  it('passes `height` and `layout` through as attribute strings', () => {
    expect(renderingToAttrs({ height: 120, layout: 'default' })).toEqual({
      height: '120',
      layout: 'default',
    });
  });

  it('omits fields that are undefined (never emits `color: undefined`)', () => {
    // Lit sets `attr="undefined"` literally if you hand it `undefined`
    // via string interpolation — we must leave the key off entirely
    // so the element's own default takes effect.
    expect(renderingToAttrs({ color: '#abcdef' })).toEqual({
      color: '#abcdef',
    });
    expect(renderingToAttrs({ shape: 'rectangle' })).toEqual({
      shape: 'rectangle',
    });
  });

  it('flattens a themed colorScale onto scale / colorRange', () => {
    expect(
      renderingToAttrs({
        color: '#112233',
        shape: 'circle',
        colorScale: { theme: 'alphafold-ramp' },
      })
    ).toEqual({
      color: '#112233',
      shape: 'circle',
      scale: 'H:90,M:70,L:50,D:0',
      colorRange:
        '#ff7d45:0,#ffdb13:50,#65cbf3:70,#0053d6:90,#0053d6:100',
    });
  });

  it('flattens a stops-only colorScale with no scale attribute', () => {
    expect(
      renderingToAttrs({
        colorScale: {
          stops: [
            { value: 0, color: '#ffffff' },
            { value: 1, color: '#000000' },
          ],
        },
      })
    ).toEqual({
      colorRange: '#ffffff:0,#000000:1',
    });
  });

  it('omits scale when only colorRange is produced (stops-only path)', () => {
    const out = renderingToAttrs({
      colorScale: {
        stops: [{ value: 0, color: '#111' }],
      },
    });
    expect(out).toHaveProperty('colorRange');
    expect(out).not.toHaveProperty('scale');
  });

  it('omits colorScale fields entirely for an unknown theme', () => {
    // Mirrors `colorScaleToAttrs`' behaviour — unknown theme + no
    // stops = no attributes. `color` / `shape` should still flow
    // through untouched.
    expect(
      renderingToAttrs({
        color: '#abc',
        colorScale: { theme: 'not-a-registered-theme' },
      })
    ).toEqual({ color: '#abc' });
  });
});
