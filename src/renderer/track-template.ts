/**
 * The Lit template for one drawn track: the `<nightingale-*>` element a
 * row or track renders into its content cell.
 *
 * A pure function of its inputs — `<protvista-uniprot>`'s `getTrack()`
 * supplies the viewer-wide state (sequence length, display window) and
 * the call site supplies the track's own attributes. Keeping it out of the
 * host element lets the attribute mapping be read, and tested, on its own.
 */
import { html, type TemplateResult } from 'lit';

import { colorConfig } from '../filter-config.js';
import type { KnownComponentName } from '../schema/types.js';
import { CSS_PREFIX } from '../styles/css-prefix.js';

/**
 * The id of the `<div>` a heatmap draws into, unique per track key.
 * `heatmap-component` finds it with `d3.select('#' + id)`, an unescaped CSS
 * selector, so only ASCII letters, digits and `-` pass through: `_` becomes
 * `__`, and every other character `_<hex code point>_`. No escape is a prefix
 * of another, so the mapping is one-to-one: `am.v1` and `am_v1`, or `hm-α`
 * and `hm-β`, get different ids, where replacing each with a bare `_` gave
 * them the same one.
 */
const heatmapDivId = (key: string): string =>
  `${CSS_PREFIX}-heatmap-${key.replace(/[^A-Za-z0-9-]/gu, (c) =>
    c === '_' ? '__' : `_${c.codePointAt(0)!.toString(16)}_`
  )}`;

/** Each built-in component's height when `rendering.height` is unset. */
export const DEFAULT_TRACK_HEIGHT: Record<string, number> = {
  'nightingale-track-canvas': 40,
  'nightingale-variation-canvas': 500,
  'nightingale-linegraph-track': 50,
  'nightingale-colored-sequence': 13,
  'nightingale-sequence-heatmap': 300,
};

/**
 * A track's own attributes, as a call site hands them to `getTrack()`.
 * Every field is optional; an unset string attribute renders empty, and
 * `showSeriesLabel` defaults to `true`.
 */
export interface TrackOptions {
  layout?: string;
  color?: string;
  shape?: string;
  /** Track key; rendered as the element id `${CSS_PREFIX}-track-${id}`. */
  id?: string;
  scale?: string;
  colorRange?: string;
  showSeriesLabel?: boolean;
  /** The track's `rendering.height`; the component default when unset. */
  height?: string;
}

/** The viewer-wide state every track element shares. */
export interface TrackViewport {
  length?: number;
  displayStart?: number;
  displayEnd?: number;
}

/**
 * Render the `<nightingale-*>` element for `component`, or `undefined` for
 * a component with no `case` here.
 *
 * lit-html doesn't allow dynamic tag names, hence the switch/case with
 * repeated markup. The attributes every element shares (`length`,
 * `display-start`, `display-end`, `id`, `height`) are resolved once above
 * the switch; each component keeps its own default height.
 */
export function trackTemplate(
  component: KnownComponentName | string,
  viewport: TrackViewport,
  options: TrackOptions
): TemplateResult | undefined {
  const { length, displayStart, displayEnd } = viewport;
  const id = `${CSS_PREFIX}-track-${options.id ?? ''}`;
  const height = options.height || DEFAULT_TRACK_HEIGHT[component];
  switch (component) {
    case 'nightingale-track-canvas':
      return html`
        <nightingale-track-canvas
          length="${length}"
          height="${height}"
          layout="${options.layout}"
          color="${options.color}"
          shape="${options.shape}"
          display-start="${displayStart}"
          display-end="${displayEnd}"
          id="${id}"
          highlight-event="onclick"
          use-ctrl-to-zoom
        >
        </nightingale-track-canvas>
      `;
    case 'nightingale-variation-canvas':
      return html`
        <nightingale-variation-canvas
          length="${length}"
          height="${height}"
          display-start="${displayStart}"
          display-end="${displayEnd}"
          id="${id}"
          .colorConfig=${colorConfig}
          highlight-event="onclick"
          use-ctrl-to-zoom
        >
        </nightingale-variation-canvas>
      `;
    case 'nightingale-linegraph-track':
      return html`
        <nightingale-linegraph-track
          length="${length}"
          height="${height}"
          display-start="${displayStart}"
          display-end="${displayEnd}"
          id="${id}"
          ?show-label-name="${options.showSeriesLabel ?? true}"
          highlight-on-click
          use-ctrl-to-zoom
        >
        </nightingale-linegraph-track>
      `;
    case 'nightingale-colored-sequence':
      return html`
        <nightingale-colored-sequence
          length="${length}"
          display-start="${displayStart}"
          display-end="${displayEnd}"
          id="${id}"
          scale="${options.scale}"
          color-range="${options.colorRange}"
          height="${height}"
          highlight-event="onclick"
          use-ctrl-to-zoom
        >
        </nightingale-colored-sequence>
      `;

    case 'nightingale-sequence-heatmap':
      return html`
        <nightingale-sequence-heatmap
          id="${id}"
          heatmap-id="${heatmapDivId(options.id ?? '')}"
          length="${length}"
          display-start="${displayStart}"
          display-end="${displayEnd}"
          highlight-event="onclick"
          highlight-color="#EB3BFF66"
          height="${height}"
          use-ctrl-to-zoom
        >
        </nightingale-sequence-heatmap>
      `;
    default:
      // Reached when a component is registered and validated but has no
      // `case` here — the current gap for consumer components (see
      // "Register + load + render" in docs/architecture.md). Draw nothing,
      // and say nothing from here: `registerConfigComponents` has already
      // reported it once for the whole config, through the router. A report
      // from inside `render()` could only reach the console anyway, and
      // would repeat on every pass.
      return undefined;
  }
}
