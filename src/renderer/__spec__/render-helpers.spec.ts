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
  renderingToAttrs,
} from '../render-helpers';

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
        'B:0,H:0.1132,V:0.2264,L:0.3395,A:0.4527,l:0.5895,h:0.7264,p:0.8632,P:1',
      colorRange:
        '#2166ac:0,#4290bf:0.1132,#8cbcd4:0.2264,#c3d6e0:0.3395,#e2e2e2:0.4527,#edcdba:0.5895,#e99e7c:0.7264,#d15e4b:0.8632,#b2182b:1',
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
