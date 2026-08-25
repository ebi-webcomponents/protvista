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
 * this module produces is a plain `rgb()` literal that parses everywhere.
 *
 * Resolution is delegated to the browser (a throwaway probe element)
 * rather than hand-parsed, so authors get the full CSS colour syntax their
 * browser supports — hex, keywords, `rgb()`, `hsl()`, `color()` — instead
 * of a subset we happened to implement. It also means an unparseable value
 * is rejected rather than passed through to the stylesheet.
 */

import { TOKENS } from './tokens.js';

/** An opaque sRGB colour, channels in 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
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

/** `rgb(…)` / `rgba(…)`, the form every engine serialises a colour to. */
const RGB_FUNC = /^rgba?\(([^)]+)\)$/;

/**
 * Resolve any CSS colour string to opaque sRGB channels, or `null` if the
 * browser cannot parse it (which includes anything carrying extra
 * declarations, so a config value can never smuggle CSS into the sheet).
 *
 * Translucent colours are composited over {@link SURFACE}.
 */
export function resolveColor(value: string): Rgb | null {
  const doc = globalThis.document;
  if (!doc?.body) return null;

  const probe = doc.createElement('span');
  // `display: none` keeps the probe out of layout; `color` still resolves.
  probe.style.display = 'none';
  probe.style.color = value;
  // CSSOM drops a declaration it cannot parse, leaving the property empty
  // — the only reliable "was that a colour?" test, since a computed style
  // reports inherited black for an invalid value just as it would for a
  // genuine `black`.
  if (!probe.style.color) return null;

  let computed: string;
  doc.body.append(probe);
  try {
    computed = getComputedStyle(probe).color;
  } finally {
    probe.remove();
  }

  // Everything an author is likely to write — hex, keyword, `rgb()`,
  // `hsl()` — serialises to `rgb()`. A wide-gamut `color()` does not, and
  // is treated as unresolvable rather than approximated.
  const parts = RGB_FUNC.exec(computed.trim());
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

  const [r, g, b] = nums;
  const alpha = nums.length > 3 && Number.isFinite(nums[3]) ? nums[3] : 1;
  return alpha >= 1
    ? { r, g, b }
    : mix({ r, g, b }, SURFACE, alpha);
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
  if (!cachedDefaultText) {
    const declared = TOKENS.find(
      (t) => t.name === '--protvista-color-text'
    )?.default;
    // The fallback only fires with no DOM to resolve against; the
    // registry value is the source of truth in every real environment.
    cachedDefaultText = (declared && resolveColor(declared)) ?? {
      r: 0x22,
      g: 0x22,
      b: 0x22,
    };
  }
  return cachedDefaultText;
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
