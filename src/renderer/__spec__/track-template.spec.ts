/**
 * Unit tests for `src/renderer/track-template.ts`.
 *
 * `trackTemplate` is the pure half of `<protvista-uniprot>`'s `getTrack()`:
 * given a component name, the viewer-wide viewport and a track's own
 * attributes, it returns the `<nightingale-*>` element to draw. The full
 * per-component attribute sets are pinned by the snapshots in
 * `src/__spec__/render-target.spec.ts`; these cases cover the attributes
 * resolved once for every component — `length`, the display window, `id`
 * and `height` — and the option defaults.
 */
import { describe, it, expect } from 'vitest';
import { render } from 'lit';

import {
  DEFAULT_TRACK_HEIGHT,
  trackTemplate,
  type TrackOptions,
} from '../track-template.js';
import { CSS_PREFIX } from '../../styles/css-prefix.js';

const COMPONENTS = Object.keys(DEFAULT_TRACK_HEIGHT);

const VIEWPORT = { length: 770, displayStart: 10, displayEnd: 200 };

/** Render the template for `component` and return its element. */
function draw(component: string, options: TrackOptions = {}): Element {
  const target = document.createElement('div');
  render(trackTemplate(component, VIEWPORT, options), target);
  return target.querySelector(component)!;
}

describe('trackTemplate', () => {
  for (const component of COMPONENTS) {
    it(`${component} → shared attributes from the viewport and options`, () => {
      const el = draw(component, { id: 'GROUP-track' });
      expect(el.getAttribute('length')).toBe('770');
      expect(el.getAttribute('display-start')).toBe('10');
      expect(el.getAttribute('display-end')).toBe('200');
      expect(el.id).toBe(`${CSS_PREFIX}-track-GROUP-track`);
      expect(el.getAttribute('height')).toBe(
        String(DEFAULT_TRACK_HEIGHT[component])
      );
    });

    it(`${component} → rendering.height replaces the default`, () => {
      expect(draw(component, { height: '120' }).getAttribute('height')).toBe(
        '120'
      );
    });

    it(`${component} → an unset id leaves a bare prefix`, () => {
      expect(draw(component).id).toBe(`${CSS_PREFIX}-track-`);
    });
  }

  it('renders unset string attributes empty', () => {
    const el = draw('nightingale-track-canvas');
    expect(el.getAttribute('layout')).toBe('');
    expect(el.getAttribute('color')).toBe('');
    expect(el.getAttribute('shape')).toBe('');
  });

  it('shows the linegraph series label unless told not to', () => {
    const component = 'nightingale-linegraph-track';
    expect(draw(component).hasAttribute('show-label-name')).toBe(true);
    expect(
      draw(component, { showSeriesLabel: false }).hasAttribute(
        'show-label-name'
      )
    ).toBe(false);
  });

  it('returns undefined for a component with no case', () => {
    expect(trackTemplate('acme-custom-track', VIEWPORT, {})).toBeUndefined();
  });
});
