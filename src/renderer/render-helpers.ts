/**
 * Pure helpers that bridge `NormalizedTrack` / `NormalizedRow`
 * rendering state onto the low-level HTML attribute shape Nightingale's
 * web components consume.
 *
 * The normalize pipeline (`src/schema/normalize.ts`) carries rendering
 * as a structured `RenderingOptions` object — `color`, `shape`, `height`,
 * `layout`, and an optional `colorScale: { theme | stops }`. Nightingale's
 * `<nightingale-colored-sequence>` however still reads two flat string
 * attributes, `scale` (letter-coded thresholds like `H:90,M:70,…`) and
 * `color-range` (hex-stop list like `#ff7d45:0,#ffdb13:50,…`). This
 * module is the one place where that translation happens; the renderer
 * and `load-data.ts` both go through `renderingToAttrs()` rather than
 * poking at `colorScale` themselves.
 *
 * Extracted from the (now-deleted) `config-bridge.ts` so the schema
 * loader output can flow directly into `<protvista-uniprot>` without
 * an intermediate legacy-shaped adapter. The two built-in themes map to
 * byte-for-byte the legacy strings the pre-schema config used, so
 * existing consumers see no visual change.
 */
import type {
  ColorScaleConfig,
  ColorStop,
  RenderingOptions,
} from '../schema/types.js';
import { interpolateRgba, parseCssColor } from './css-color.js';

/**
 * Canonical theme → legacy `(scale, colorRange)` strings.
 *
 * `<nightingale-colored-sequence>` reads `scale` as a letter-coded
 * threshold list (`H:90,M:70,…`) which the 3-stop `ColorStop[]` form
 * doesn't carry. For the two built-in themes we hardcode the exact
 * legacy strings so parity with the pre-migration viewer is byte-for-
 * byte. Authors registering a custom theme get a synthesised
 * `colorRange` and no `scale` — which is fine for simple gradients
 * but stops the AlphaFold/AlphaMissense threshold labels from
 * appearing on custom scales.
 */
const THEME_TO_ATTRS: Readonly<
  Record<string, { scale: string; colorRange: string }>
> = {
  'alphafold-ramp': {
    scale: 'H:90,M:70,L:50,D:0',
    colorRange:
      '#ff7d45:0,#ffdb13:50,#65cbf3:70,#0053d6:90,#0053d6:100',
  },
  // `-` is the pathogenicity adapter's placeholder for a residue the CSV has
  // no score for. Without its own entry nightingale-colored-sequence would
  // draw it at 0, the certainly-benign colour; at -1 it lands on a
  // transparent stop that no real score (all within 0..1) reaches. The
  // heatmap's colour function leaves that stop out (see PLACEHOLDER_STOPS).
  'alphamissense-ramp': {
    scale:
      '-:-1,B:0,H:0.1132,V:0.2264,L:0.3395,A:0.4527,l:0.5895,h:0.7264,p:0.8632,P:1',
    colorRange:
      'transparent:-1,#2166ac:0,#4290bf:0.1132,#8cbcd4:0.2264,#c3d6e0:0.3395,#e2e2e2:0.4527,#edcdba:0.5895,#e99e7c:0.7264,#d15e4b:0.8632,#b2182b:1',
  },
};

/**
 * Built-in theme stops that only give a coloured sequence's placeholder
 * character a colour, so they are not part of the numeric ramp a colour
 * function interpolates.
 */
const PLACEHOLDER_STOPS: ReadonlySet<string> = new Set(['transparent:-1']);

/**
 * Render a `ColorScaleConfig` to Nightingale's flat `(scale,
 * colorRange)` attribute pair. Explicit `stops` take precedence over a
 * `theme`; unrecognised themes fall through to an empty object.
 */
export function colorScaleToAttrs(
  cs: ColorScaleConfig | undefined
): { scale?: string; colorRange?: string } {
  if (!cs) return {};
  if (cs.stops && cs.stops.length > 0) {
    return {
      colorRange: cs.stops.map((s) => `${s.color}:${s.value}`).join(','),
    };
  }
  if (cs.theme && THEME_TO_ATTRS[cs.theme]) {
    return { ...THEME_TO_ATTRS[cs.theme] };
  }
  return {};
}

/**
 * Resolve a `ColorScaleConfig` to a value → CSS colour function, for
 * components that colour each datum themselves
 * (`<nightingale-sequence-heatmap>` via `heatmapInstance.setColor`) rather
 * than reading the `scale` / `color-range` attributes.
 *
 * Stop resolution matches `colorScaleToAttrs`: explicit `stops` first, then
 * a built-in theme's legacy `colorRange` (so `alphamissense-ramp` keeps the
 * nine-stop ramp the coloured sequence draws), then a theme registered via
 * `registerTheme()` through `getTheme`. `undefined` when nothing resolves,
 * so the component keeps its own default colouring.
 *
 * The interpolation is piecewise-linear in RGB, extrapolating past the end
 * stops and printing `rgb(r, g, b)` (or `rgba(…)` below full opacity),
 * exactly as the d3 `scaleLinear` the heatmap used before did (`amColorScale`
 * from nightingale-structure), so the default AlphaMissense heatmap draws the
 * same pixels. It reads every colour d3 reads (hex, `rgb()`, `hsl()`, named
 * colours; see `css-color.ts`), so the same stops draw the same gradient as
 * on a coloured sequence. A missing or non-numeric value gives `undefined`,
 * as that scale did. A stop d3 cannot read either (a `var()`, say) is not
 * interpolated: each value next to it takes the colour of the stop at or
 * below it.
 */
export function colorScaleToColorFn(
  cs: ColorScaleConfig | undefined,
  getTheme?: (name: string) => readonly ColorStop[] | undefined
): ((value: number) => string | undefined) | undefined {
  if (!cs) return undefined;
  let stops: readonly ColorStop[] | undefined;
  if (cs.stops && cs.stops.length > 0) {
    stops = cs.stops;
  } else if (cs.theme && THEME_TO_ATTRS[cs.theme]) {
    stops = THEME_TO_ATTRS[cs.theme].colorRange
      .split(',')
      .filter((pair) => !PLACEHOLDER_STOPS.has(pair))
      .map((pair) => {
        const [color, value] = pair.split(':');
        return { color, value: Number(value) };
      });
  } else if (cs.theme) {
    stops = getTheme?.(cs.theme);
  }
  if (!stops || stops.length === 0) return undefined;

  const sorted = [...stops].sort((a, b) => a.value - b.value);
  const values = sorted.map((s) => s.value);
  const rgbs = sorted.map((s) => parseCssColor(s.color));
  const last = sorted.length - 1;
  return (value: number) => {
    if (value == null || Number.isNaN(Number(value))) return undefined;
    const x = Number(value);
    if (last === 0) return sorted[0].color;
    // The segment whose lower stop is the last one at or below `x`, clamped
    // to the first / last segment so values outside the stops extrapolate.
    let i = 0;
    while (i < last - 1 && x >= values[i + 1]) i++;
    const a = rgbs[i];
    const b = rgbs[i + 1];
    if (!a || !b) return sorted[x >= values[i + 1] ? i + 1 : i].color;
    const span = values[i + 1] - values[i];
    const t = span ? (x - values[i]) / span : 0.5;
    return interpolateRgba(a, b, t);
  };
}

/**
 * Shape of the HTML attributes the renderer hands down to
 * `<nightingale-*>` elements. All fields are optional strings —
 * callers typically spread or destructure only the keys they need.
 */
interface NightingaleRenderAttrs {
  color?: string;
  shape?: string;
  height?: string;
  layout?: string;
  scale?: string;
  colorRange?: string;
}

/**
 * Flatten a `RenderingOptions` to the plain-string attribute shape.
 * Safe to call on the always-present `rendering` field of any
 * `NormalizedRow` or `NormalizedTrack`.
 */
export function renderingToAttrs(r: RenderingOptions): NightingaleRenderAttrs {
  const out: NightingaleRenderAttrs = {};
  if (r.color !== undefined) out.color = r.color;
  if (r.shape !== undefined) out.shape = r.shape;
  if (r.height !== undefined) out.height = String(r.height);
  if (r.layout !== undefined) out.layout = r.layout;
  const cs = colorScaleToAttrs(r.colorScale);
  if (cs.scale !== undefined) out.scale = cs.scale;
  if (cs.colorRange !== undefined) out.colorRange = cs.colorRange;
  return out;
}
