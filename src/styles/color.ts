/**
 * The viewer's only colour maths, used by the no-code config `theme:`
 * block (`ProtvistaUniprot.applyTheme`).
 *
 * Why it exists: `theme.labelColor` is one author-supplied colour that has
 * to become *four* related values — a group-label background, a lighter
 * track-label background derived from it, a hover background, and text
 * that stays readable on top. CSS can express the first three
 * (`color-mix()`), but not the fourth: there is no portable way to ask CSS
 * "pick whichever of these two text colours contrasts better". So the
 * derivation happens here, in JS, at mount.
 *
 * Deriving *all* of them here rather than only the text colour is what
 * keeps the pipeline coherent — and it means we never emit `color-mix()`,
 * which is unsupported below Chrome/Edge 111, Firefox 113 and Safari 16.2
 * and so would fall outside the support matrix this package documents
 * (Chrome/Edge 92+, Firefox 90+, Safari 15+ — see README.md). Every value
 * this module produces is a plain `rgb()`/`rgba()` literal that parses
 * everywhere.
 *
 * Resolution takes two routes:
 *
 *   1. The CIE and Oklab function syntaxes — `oklch()`, `oklab()`,
 *      `lab()`, `lch()`, and `color()` in `srgb` / `srgb-linear` /
 *      `display-p3` — are parsed and converted here. Doing the maths
 *      ourselves rather than asking the browser is what makes them work
 *      across the whole support matrix: Safari 15 cannot parse `oklch()`
 *      at all, so delegating would silently drop an author's colour on a
 *      browser we claim to support.
 *   2. Everything else — hex, keywords, `rgb()`, `hsl()`, `hwb()` — is
 *      handed to the browser via a throwaway probe element, so authors
 *      get their engine's full syntax range instead of a subset we
 *      happened to implement. It also means an unparseable value is
 *      rejected rather than passed through to the stylesheet.
 *
 * Both routes land in sRGB. A colour outside the sRGB gamut is *clamped*
 * per channel, not gamut-mapped: the result is the nearest representable
 * value along each axis, which is enough for a label surface and avoids
 * shipping a gamut-mapping implementation.
 */

import { TOKENS } from './tokens.js';

/** An opaque sRGB colour, channels in 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** An sRGB colour that has kept its alpha, `a` in 0–1. */
export interface Rgba extends Rgb {
  a: number;
}

/**
 * The surface the label column sits on. Translucent author colours are
 * composited over this before any further maths, so a semi-transparent
 * `labelColor` yields the colour the eye actually sees rather than one
 * that ignores what shows through.
 *
 * Deliberately the shipped default of `--protvista-color-surface`, not
 * the token's effective value on the page: reading the live token would
 * make the derived palette depend on stylesheet load order and go stale
 * if page CSS changes after mount, and — as with `defaultTextColor` — a
 * consumer who has repainted the surface has taken the derivation out of
 * our hands. They should set the label tokens directly instead.
 */
const SURFACE: Rgb = { r: 255, g: 255, b: 255 };

/** `rgb(…)` / `rgba(…)`, the form legacy colours serialise to. */
const RGB_FUNC = /^rgba?\(([^)]+)\)$/;

/**
 * `inherit` and friends parse as a valid `color` declaration but carry no
 * colour of their own — they would resolve to whatever the probe happened
 * to inherit, which is not the author's colour by any reading. Same for a
 * `var()` reference, which resolves against the probe's custom properties
 * rather than the viewer's.
 */
const CSS_WIDE = /^(inherit|initial|unset|revert|revert-layer)$/i;
const VAR_REF = /\bvar\s*\(/i;

/** A CIE / Oklab function: `oklch(…)`, `oklab(…)`, `lab(…)`, `lch(…)`. */
const CIE_FUNC = /^(oklch|oklab|lab|lch)\(([^)]*)\)$/i;
/** `color(<space> c1 c2 c3[ / a])`. */
const COLOR_FUNC = /^color\(([^)]*)\)$/i;

/** `<angle>` — a bare number is degrees, per CSS Color 4. */
const ANGLE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/i;

const ANGLE_TO_DEG: Record<string, number> = {
  deg: 1,
  rad: 180 / Math.PI,
  grad: 0.9,
  turn: 360,
};

/**
 * One component of a colour function: a number, a percentage against
 * `basis`, or `none` (which CSS Color 4 defines as zero once the colour
 * is used rather than interpolated).
 */
function component(token: string, basis: number): number | null {
  if (/^none$/i.test(token)) return 0;
  const isPct = token.endsWith('%');
  const value = Number(isPct ? token.slice(0, -1) : token);
  if (!Number.isFinite(value)) return null;
  return isPct ? (value / 100) * basis : value;
}

/** A hue angle in degrees. */
function angle(token: string): number | null {
  if (/^none$/i.test(token)) return 0;
  const parts = ANGLE.exec(token);
  if (!parts) return null;
  return Number(parts[1]) * ANGLE_TO_DEG[(parts[2] ?? 'deg').toLowerCase()];
}

/**
 * Split a colour function's arguments into components and alpha. CSS
 * Color 4 separates the two with `/`; commas are tolerated between
 * components so a hand-written value is not rejected on punctuation.
 */
function splitArgs(args: string): { parts: string[]; alpha: number } | null {
  const [body, alphaToken, ...rest] = args.split('/');
  if (rest.length) return null;
  const parts = body.trim().split(/[\s,]+/).filter(Boolean);
  if (alphaToken === undefined) return { parts, alpha: 1 };
  const alpha = component(alphaToken.trim(), 1);
  if (alpha === null) return null;
  return { parts, alpha: Math.min(Math.max(alpha, 0), 1) };
}

/** Apply a 3×3 matrix (row-major, flat) to a 3-vector. */
function transform(m: readonly number[], [x, y, z]: number[]): number[] {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

/** The sRGB (and Display P3) transfer function: linear light → encoded. */
function encodeGamma(c: number): number {
  const sign = c < 0 ? -1 : 1;
  const abs = Math.abs(c);
  return abs <= 0.0031308
    ? 12.92 * c
    : sign * (1.055 * abs ** (1 / 2.4) - 0.055);
}

/** Its inverse: encoded → linear light. */
function decodeGamma(c: number): number {
  const sign = c < 0 ? -1 : 1;
  const abs = Math.abs(c);
  return abs <= 0.04045 ? c / 12.92 : sign * ((abs + 0.055) / 1.055) ** 2.4;
}

/** Encoded sRGB (0–1 nominal) → 0–255 channels, clamped to the gamut. */
function toChannels([r, g, b]: number[]): Rgb {
  const channel = (c: number) => Math.round(Math.min(Math.max(c, 0), 1) * 255);
  return { r: channel(r), g: channel(g), b: channel(b) };
}

// Björn Ottosson's Oklab → LMS → linear sRGB constants.
const OKLAB_TO_LMS = [
  1, 0.3963377773761749, 0.2158037573099136, 1, -0.1055613458156586,
  -0.0638541728258133, 1, -0.0894841775298119, -1.2914855480194092,
] as const;
const LMS_TO_LINEAR_SRGB = [
  4.076741661347994, -3.307711590408193, 0.230969928729428, -1.2684380040921763,
  2.6097574006633715, -0.3413193963102197, -0.004196086541837188,
  -0.7034186144594493, 1.7076147009309444,
] as const;

// CSS Color 4 reference matrices.
const XYZ_D65_TO_LINEAR_SRGB = [
  3.2409699419045226, -1.537383177570094, -0.4986107602930034,
  -0.9692436362808796, 1.8759675015077202, 0.04155505740717559,
  0.05563007969699366, -0.20397695888897652, 1.0569715142428786,
] as const;
const D50_TO_D65_BRADFORD = [
  0.9554734527042182, -0.023098536874261423, 0.0632593086610217,
  -0.028369706963208136, 1.0099954580058226, 0.021041398966943008,
  0.012314001688319899, -0.020507696433477912, 1.3303659366080753,
] as const;
const LINEAR_P3_TO_XYZ_D65 = [
  0.4865709486482162, 0.26566769316909306, 0.1982172852343625,
  0.2289745640697488, 0.6917385218365064, 0.079286914093745, 0,
  0.04511338185890264, 1.043944368900976,
] as const;

/** The D50 white point `lab()` is defined against. */
const D50: number[] = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

/** Oklab (L 0–1, a/b ≈ ±0.4) → encoded sRGB 0–1. */
function oklabToSrgb(L: number, a: number, b: number): number[] {
  const lms = transform(OKLAB_TO_LMS, [L, a, b]).map((v) => v ** 3);
  return transform(LMS_TO_LINEAR_SRGB, lms).map(encodeGamma);
}

/** CIE Lab, D50 (L 0–100, a/b ≈ ±125) → encoded sRGB 0–1. */
function labToSrgb(L: number, a: number, b: number): number[] {
  const EPSILON = 216 / 24389;
  const KAPPA = 24389 / 27;
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const xr = fx ** 3 > EPSILON ? fx ** 3 : (116 * fx - 16) / KAPPA;
  const yr = L > KAPPA * EPSILON ? fy ** 3 : L / KAPPA;
  const zr = fz ** 3 > EPSILON ? fz ** 3 : (116 * fz - 16) / KAPPA;
  const xyzD50 = [xr * D50[0], yr * D50[1], zr * D50[2]];
  const xyzD65 = transform(D50_TO_D65_BRADFORD, xyzD50);
  return transform(XYZ_D65_TO_LINEAR_SRGB, xyzD65).map(encodeGamma);
}

/** Polar (C, H°) → the rectangular a/b pair Lab and Oklab take. */
function fromPolar(chroma: number, hue: number): [number, number] {
  const radians = (hue * Math.PI) / 180;
  return [chroma * Math.cos(radians), chroma * Math.sin(radians)];
}

/**
 * `oklch()` / `oklab()` / `lab()` / `lch()`, converted here rather than
 * delegated so they resolve identically on every supported browser.
 */
function parseCieFunc(value: string): Rgba | null {
  const matched = CIE_FUNC.exec(value);
  if (!matched) return null;
  const form = matched[1].toLowerCase();
  const split = splitArgs(matched[2]);
  if (!split || split.parts.length !== 3) return null;
  const [first, second, third] = split.parts;

  // Percentage bases are the reference ranges CSS Color 4 defines for
  // each form: lightness is 0–1 for Oklab and 0–100 for Lab, and a
  // chroma of 100% is 0.4 (Oklab) or 150 (Lab).
  const isOk = form.startsWith('ok');
  const L = component(first, isOk ? 1 : 100);
  if (L === null) return null;

  let a: number | null;
  let b: number | null;
  if (form === 'oklch' || form === 'lch') {
    const chroma = component(second, isOk ? 0.4 : 150);
    const hue = angle(third);
    if (chroma === null || hue === null) return null;
    [a, b] = fromPolar(Math.max(chroma, 0), hue);
  } else {
    const axis = isOk ? 0.4 : 125;
    a = component(second, axis);
    b = component(third, axis);
    if (a === null || b === null) return null;
  }

  const srgb = isOk ? oklabToSrgb(L, a, b) : labToSrgb(L, a, b);
  return { ...toChannels(srgb), a: split.alpha };
}

/** The predefined colour spaces this module can bring back to sRGB. */
const COLOR_SPACES: Record<string, (rgb: number[]) => number[]> = {
  srgb: (rgb) => rgb,
  'srgb-linear': (rgb) => rgb.map(encodeGamma),
  // P3 shares the sRGB transfer function, so decode, rotate through XYZ,
  // and re-encode.
  'display-p3': (rgb) =>
    transform(
      XYZ_D65_TO_LINEAR_SRGB,
      transform(LINEAR_P3_TO_XYZ_D65, rgb.map(decodeGamma))
    ).map(encodeGamma),
};

/** `color(srgb …)` / `color(srgb-linear …)` / `color(display-p3 …)`. */
function parseColorFunc(value: string): Rgba | null {
  const matched = COLOR_FUNC.exec(value);
  if (!matched) return null;
  const split = splitArgs(matched[1]);
  if (!split || split.parts.length !== 4) return null;
  const [space, ...channels] = split.parts;
  const toSrgb = COLOR_SPACES[space.toLowerCase()];
  if (!toSrgb) return null;
  const values = channels.map((c) => component(c, 1));
  if (values.some((v) => v === null)) return null;
  return { ...toChannels(toSrgb(values as number[])), a: split.alpha };
}

/** `rgb(…)` / `rgba(…)`, in either the legacy or the modern form. */
function parseRgbFunc(value: string): Rgba | null {
  const parts = RGB_FUNC.exec(value);
  if (!parts) return null;
  // Engines serialise as `rgb(r, g, b)` / `rgba(r, g, b, a)`; newer ones
  // use spaces and a `/` before alpha. Split on either.
  const nums = parts[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (nums.length < 3 || nums.slice(0, 3).some((n) => !Number.isFinite(n))) {
    return null;
  }
  const alpha = nums.length > 3 && Number.isFinite(nums[3]) ? nums[3] : 1;
  const [r, g, b] = nums
    .slice(0, 3)
    .map((n) => Math.round(Math.min(Math.max(n, 0), 255)));
  return { r, g, b, a: Math.min(Math.max(alpha, 0), 1) };
}

/**
 * The syntaxes this module converts itself. `rgb()` is deliberately not
 * among them for an *authored* value: the browser normalises out-of-range
 * channels and legacy quirks better than a hand parser would, so authored
 * `rgb()` keeps going through the probe. It is parsed only on the way
 * back out, where it is an engine's own serialisation.
 */
function parseConvertedSyntax(value: string): Rgba | null {
  return parseCieFunc(value) ?? parseColorFunc(value);
}

/**
 * Resolve any CSS colour string to sRGB channels plus alpha, or `null` if
 * it is not a colour this module or the browser can parse (which includes
 * anything carrying extra declarations, so a config value can never
 * smuggle CSS into the sheet).
 *
 * `doc` is the document to resolve against — pass the element's own, so a
 * viewer adopted into another document (an iframe, a printing context)
 * measures keywords and inherited units there rather than in the top
 * document.
 */
export function resolveColorWithAlpha(
  value: string,
  doc: Document | undefined = globalThis.document
): Rgba | null {
  const text = value.trim();
  if (!text || CSS_WIDE.test(text) || VAR_REF.test(text)) return null;

  // The syntaxes we convert ourselves, so they work even where the
  // browser cannot parse them.
  const converted = parseConvertedSyntax(text);
  if (converted) return converted;

  if (!doc?.documentElement) return null;

  const probe = doc.createElement('span');
  // `display: none` keeps the probe out of layout; `color` still resolves.
  probe.style.display = 'none';
  probe.style.color = text;
  // CSSOM drops a declaration it cannot parse, leaving the property empty
  // — the only reliable "was that a colour?" test, since a computed style
  // reports inherited black for an invalid value just as it would for a
  // genuine `black`.
  if (!probe.style.color) return null;

  let computed: string;
  // `documentElement` rather than `body`: a viewer can be upgraded before
  // body exists, and dropping the whole theme over that would be worse
  // than parenting the probe one level up. Computed colour is unaffected.
  doc.documentElement.append(probe);
  try {
    // The probe's own view, to match the document it was created in —
    // falling back to this one for a document with no browsing context.
    computed = (doc.defaultView ?? globalThis).getComputedStyle(probe).color;
  } finally {
    probe.remove();
  }

  // Legacy colours serialise to `rgb()`; a colour written in a modern
  // space may come back in that space, so the converters run over the
  // computed value too rather than rejecting what they could handle.
  const serialised = computed.trim();
  return parseRgbFunc(serialised) ?? parseConvertedSyntax(serialised);
}

/**
 * Resolve any CSS colour string to *opaque* sRGB channels, or `null` if
 * the value is not a resolvable colour.
 *
 * Translucent colours are composited over {@link SURFACE}, because every
 * caller measures contrast against the result and contrast is a property
 * of what the eye actually sees. Use {@link resolveColorWithAlpha} where
 * the alpha itself has to survive.
 */
export function resolveColor(value: string, doc?: Document): Rgb | null {
  const resolved = resolveColorWithAlpha(value, doc);
  if (!resolved) return null;
  const { r, g, b, a } = resolved;
  return a >= 1 ? { r, g, b } : mix({ r, g, b }, SURFACE, a);
}

/** Blend `weight` (0–1) of `color` with `1 - weight` of `onto`. */
export function mix(color: Rgb, onto: Rgb, weight: number): Rgb {
  const channel = (a: number, b: number) =>
    Math.round(a * weight + b * (1 - weight));
  return {
    r: channel(color.r, onto.r),
    g: channel(color.g, onto.g),
    b: channel(color.b, onto.b),
  };
}

/** Lighten toward the surface colour — the `color-mix(…, white)` tint. */
export function tint(color: Rgb, weight: number): Rgb {
  return mix(color, SURFACE, weight);
}

/** Serialise for a custom property: a literal every browser parses. */
export function cssRgb({ r, g, b }: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Serialise keeping alpha. Emitted only where a translucent value is
 * meaningful — see `applyTheme`'s accent handling; a label surface is
 * flattened first, because its text colour is chosen against it.
 */
export function cssRgba({ r, g, b, a }: Rgba): string {
  return a >= 1 ? cssRgb({ r, g, b }) : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** WCAG 2.x relative luminance (sRGB, 0 = black, 1 = white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.x contrast ratio between two colours: 1 (identical) to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x
  );
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pick whichever candidate reads better on `background`.
 *
 * Used to keep a themed label legible: an author who sets a dark
 * `labelColor` would otherwise get the default near-black body text on a
 * near-black fill. Choosing the better of the two guarantees we never make
 * contrast *worse* than shipping the default would have.
 */
export function readableOn(background: Rgb, candidates: [Rgb, Rgb]): Rgb {
  const [first, second] = candidates;
  return contrastRatio(background, second) > contrastRatio(background, first)
    ? second
    : first;
}

/** The light half of the text choice — the only sensible partner to a
 *  near-black body text when a surface turns dark. White in its own
 *  right, not an alias of {@link SURFACE}: the two are equal by
 *  coincidence, and a future non-white surface must not drag the text
 *  candidate with it. */
export const TEXT_ON_DARK: Rgb = { r: 255, g: 255, b: 255 };

/** Used only when the registry default cannot be resolved at all. */
const TEXT_FALLBACK: Rgb = { r: 0x22, g: 0x22, b: 0x22 };

let cachedDefaultText: Rgb | null = null;

/**
 * The dark half of the text choice: the shipped body-text colour, read
 * from the token registry so it cannot drift from `--protvista-color-text`.
 *
 * Deliberately the registry *default* rather than the token's effective
 * value on the host: the two candidates have to straddle light and dark
 * for the choice to mean anything, and a consumer who has already
 * repainted the body text to something light has taken the decision out
 * of our hands.
 */
export function defaultTextColor(): Rgb {
  if (cachedDefaultText) return cachedDefaultText;
  const declared = TOKENS.find(
    (t) => t.name === '--protvista-color-text'
  )?.default;
  const resolved = declared ? resolveColor(declared) : null;
  // Only a successful resolution is cached. The fallback fires when there
  // is no DOM to resolve against, and caching it would let one early call
  // pin the wrong colour for the lifetime of the page — defeating the
  // registry-is-the-source-of-truth guarantee above.
  if (resolved) cachedDefaultText = resolved;
  return resolved ?? TEXT_FALLBACK;
}

/**
 * Share of `labelColor` in the derived track-label background. Low enough
 * that the track surface reads as the recessive half of the pair — the
 * same relationship the shipped `#f1f3f5` / `#ffffff` defaults draw.
 */
export const TRACK_LABEL_TINT = 0.25;

/**
 * Share of the text colour in the muted variant. Chosen so the default
 * `#222222` text over a white surface mutes to `rgb(78, 78, 78)` —
 * within a few channel steps of the shipped
 * `--protvista-color-text-muted` (`#4a5056`), close enough to be
 * indistinguishable in a label cell — so an unthemed-looking label mutes
 * essentially as it always has.
 */
export const MUTED_TEXT_WEIGHT = 0.8;

/** How far a hovered group label moves toward its own text colour. */
export const GROUP_LABEL_HOVER_SHIFT = 0.08;
