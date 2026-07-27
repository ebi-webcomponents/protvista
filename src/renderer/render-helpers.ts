/**
 * Pure helpers that bridge `NormalizedTrack` / `NormalizedRow`
 * rendering state onto the low-level HTML attribute shape Nightingale's
 * web components consume.
 *
 * The normalize pipeline (`src/schema/normalize.ts`) carries rendering
 * as a structured `RenderingOptions` object — `color`, `shape`, and an
 * optional `colorScale: { theme | stops }`. Nightingale's
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
  RenderingOptions,
} from '../schema/types.js';

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
  'alphamissense-ramp': {
    scale:
      'B:0,H:0.1132,V:0.2264,L:0.3395,A:0.4527,l:0.5895,h:0.7264,p:0.8632,P:1',
    colorRange:
      '#2166ac:0,#4290bf:0.1132,#8cbcd4:0.2264,#c3d6e0:0.3395,#e2e2e2:0.4527,#edcdba:0.5895,#e99e7c:0.7264,#d15e4b:0.8632,#b2182b:1',
  },
};

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
 * Shape of the HTML attributes the renderer hands down to
 * `<nightingale-*>` elements. All fields are optional strings —
 * callers typically spread or destructure only the keys they need.
 */
interface NightingaleRenderAttrs {
  color?: string;
  shape?: string;
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
  const cs = colorScaleToAttrs(r.colorScale);
  if (cs.scale !== undefined) out.scale = cs.scale;
  if (cs.colorRange !== undefined) out.colorRange = cs.colorRange;
  return out;
}
