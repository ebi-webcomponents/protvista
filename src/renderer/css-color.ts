/**
 * CSS colour parsing and RGB interpolation, done the way d3 does them.
 *
 * `<nightingale-colored-sequence>` turns a `colorScale` into a d3
 * `scaleLinear` over its stops, and the heatmap used to colour its cells with
 * one (`amColorScale`). `colorScaleToColorFn` builds the heatmap's colour
 * function without d3, so this module reproduces the two pieces of d3 it
 * needs: `d3-color`'s `color()` parser (hex with or without alpha, `rgb()` /
 * `rgba()`, `hsl()` / `hsla()`, the CSS named colours and `transparent`) and
 * `d3-interpolate`'s `interpolateRgb` (linear per channel, printed as
 * `rgb(r, g, b)` or `rgba(r, g, b, a)`). The same stops therefore draw the
 * same colours on a heatmap as on a coloured sequence.
 *
 * Ported from d3-color 3.1.0 and d3-interpolate 3.0.1 (ISC licence,
 * Copyright 2010-2022 Mike Bostock).
 */

/** Red, green, blue (0-255, unclamped) and opacity; `NaN` means "unset". */
export type Rgba = [number, number, number, number];

const reI = '\\s*([+-]?\\d+)\\s*';
const reN = '\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*';
const reP = '\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*';
const reHex = /^#([0-9a-f]{3,8})$/;
const reRgbInteger = new RegExp(`^rgb\\(${reI},${reI},${reI}\\)$`);
const reRgbPercent = new RegExp(`^rgb\\(${reP},${reP},${reP}\\)$`);
const reRgbaInteger = new RegExp(`^rgba\\(${reI},${reI},${reI},${reN}\\)$`);
const reRgbaPercent = new RegExp(`^rgba\\(${reP},${reP},${reP},${reN}\\)$`);
const reHslPercent = new RegExp(`^hsl\\(${reN},${reP},${reP}\\)$`);
const reHslaPercent = new RegExp(`^hsla\\(${reN},${reP},${reP},${reN}\\)$`);

/** The CSS named colours, as `0xrrggbb`. */
const NAMED: Readonly<Record<string, number>> = {
  aliceblue: 0xf0f8ff,
  antiquewhite: 0xfaebd7,
  aqua: 0x00ffff,
  aquamarine: 0x7fffd4,
  azure: 0xf0ffff,
  beige: 0xf5f5dc,
  bisque: 0xffe4c4,
  black: 0x000000,
  blanchedalmond: 0xffebcd,
  blue: 0x0000ff,
  blueviolet: 0x8a2be2,
  brown: 0xa52a2a,
  burlywood: 0xdeb887,
  cadetblue: 0x5f9ea0,
  chartreuse: 0x7fff00,
  chocolate: 0xd2691e,
  coral: 0xff7f50,
  cornflowerblue: 0x6495ed,
  cornsilk: 0xfff8dc,
  crimson: 0xdc143c,
  cyan: 0x00ffff,
  darkblue: 0x00008b,
  darkcyan: 0x008b8b,
  darkgoldenrod: 0xb8860b,
  darkgray: 0xa9a9a9,
  darkgreen: 0x006400,
  darkgrey: 0xa9a9a9,
  darkkhaki: 0xbdb76b,
  darkmagenta: 0x8b008b,
  darkolivegreen: 0x556b2f,
  darkorange: 0xff8c00,
  darkorchid: 0x9932cc,
  darkred: 0x8b0000,
  darksalmon: 0xe9967a,
  darkseagreen: 0x8fbc8f,
  darkslateblue: 0x483d8b,
  darkslategray: 0x2f4f4f,
  darkslategrey: 0x2f4f4f,
  darkturquoise: 0x00ced1,
  darkviolet: 0x9400d3,
  deeppink: 0xff1493,
  deepskyblue: 0x00bfff,
  dimgray: 0x696969,
  dimgrey: 0x696969,
  dodgerblue: 0x1e90ff,
  firebrick: 0xb22222,
  floralwhite: 0xfffaf0,
  forestgreen: 0x228b22,
  fuchsia: 0xff00ff,
  gainsboro: 0xdcdcdc,
  ghostwhite: 0xf8f8ff,
  gold: 0xffd700,
  goldenrod: 0xdaa520,
  gray: 0x808080,
  green: 0x008000,
  greenyellow: 0xadff2f,
  grey: 0x808080,
  honeydew: 0xf0fff0,
  hotpink: 0xff69b4,
  indianred: 0xcd5c5c,
  indigo: 0x4b0082,
  ivory: 0xfffff0,
  khaki: 0xf0e68c,
  lavender: 0xe6e6fa,
  lavenderblush: 0xfff0f5,
  lawngreen: 0x7cfc00,
  lemonchiffon: 0xfffacd,
  lightblue: 0xadd8e6,
  lightcoral: 0xf08080,
  lightcyan: 0xe0ffff,
  lightgoldenrodyellow: 0xfafad2,
  lightgray: 0xd3d3d3,
  lightgreen: 0x90ee90,
  lightgrey: 0xd3d3d3,
  lightpink: 0xffb6c1,
  lightsalmon: 0xffa07a,
  lightseagreen: 0x20b2aa,
  lightskyblue: 0x87cefa,
  lightslategray: 0x778899,
  lightslategrey: 0x778899,
  lightsteelblue: 0xb0c4de,
  lightyellow: 0xffffe0,
  lime: 0x00ff00,
  limegreen: 0x32cd32,
  linen: 0xfaf0e6,
  magenta: 0xff00ff,
  maroon: 0x800000,
  mediumaquamarine: 0x66cdaa,
  mediumblue: 0x0000cd,
  mediumorchid: 0xba55d3,
  mediumpurple: 0x9370db,
  mediumseagreen: 0x3cb371,
  mediumslateblue: 0x7b68ee,
  mediumspringgreen: 0x00fa9a,
  mediumturquoise: 0x48d1cc,
  mediumvioletred: 0xc71585,
  midnightblue: 0x191970,
  mintcream: 0xf5fffa,
  mistyrose: 0xffe4e1,
  moccasin: 0xffe4b5,
  navajowhite: 0xffdead,
  navy: 0x000080,
  oldlace: 0xfdf5e6,
  olive: 0x808000,
  olivedrab: 0x6b8e23,
  orange: 0xffa500,
  orangered: 0xff4500,
  orchid: 0xda70d6,
  palegoldenrod: 0xeee8aa,
  palegreen: 0x98fb98,
  paleturquoise: 0xafeeee,
  palevioletred: 0xdb7093,
  papayawhip: 0xffefd5,
  peachpuff: 0xffdab9,
  peru: 0xcd853f,
  pink: 0xffc0cb,
  plum: 0xdda0dd,
  powderblue: 0xb0e0e6,
  purple: 0x800080,
  rebeccapurple: 0x663399,
  red: 0xff0000,
  rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1,
  saddlebrown: 0x8b4513,
  salmon: 0xfa8072,
  sandybrown: 0xf4a460,
  seagreen: 0x2e8b57,
  seashell: 0xfff5ee,
  sienna: 0xa0522d,
  silver: 0xc0c0c0,
  skyblue: 0x87ceeb,
  slateblue: 0x6a5acd,
  slategray: 0x708090,
  slategrey: 0x708090,
  snow: 0xfffafa,
  springgreen: 0x00ff7f,
  steelblue: 0x4682b4,
  tan: 0xd2b48c,
  teal: 0x008080,
  thistle: 0xd8bfd8,
  tomato: 0xff6347,
  turquoise: 0x40e0d0,
  violet: 0xee82ee,
  wheat: 0xf5deb3,
  white: 0xffffff,
  whitesmoke: 0xf5f5f5,
  yellow: 0xffff00,
  yellowgreen: 0x9acd32,
};

const rgbn = (n: number): Rgba => [
  (n >> 16) & 0xff,
  (n >> 8) & 0xff,
  n & 0xff,
  1,
];

/** A fully transparent colour has no channels to interpolate from. */
const rgba = (r: number, g: number, b: number, a: number): Rgba =>
  a <= 0 ? [NaN, NaN, NaN, a] : [r, g, b, a];

/** FvD 13.37, CSS Color Module Level 3. */
const hsl2rgb = (h: number, m1: number, m2: number): number =>
  (h < 60
    ? m1 + ((m2 - m1) * h) / 60
    : h < 180
      ? m2
      : h < 240
        ? m1 + ((m2 - m1) * (240 - h)) / 60
        : m1) * 255;

function hsla(h: number, s: number, l: number, a: number): Rgba {
  if (a <= 0) h = s = l = NaN;
  else if (l <= 0 || l >= 1) h = s = NaN;
  else if (s <= 0) h = NaN;
  const hue = (h % 360) + (h < 0 ? 360 : 0);
  const sat = Number.isNaN(hue) || Number.isNaN(s) ? 0 : s;
  const m2 = l + (l < 0.5 ? l : 1 - l) * sat;
  const m1 = 2 * l - m2;
  return [
    hsl2rgb(hue >= 240 ? hue - 240 : hue + 120, m1, m2),
    hsl2rgb(hue, m1, m2),
    hsl2rgb(hue < 120 ? hue + 240 : hue - 120, m1, m2),
    a,
  ];
}

/**
 * A CSS colour as RGBA channels, or `undefined` for one d3 does not read
 * either (a `var()`, `currentColor`, the space-separated `rgb(0 0 0)`).
 */
export function parseCssColor(color: string): Rgba | undefined {
  const format = String(color).trim().toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = reHex.exec(format))) {
    const l = m[1].length;
    const n = parseInt(m[1], 16);
    if (l === 6) return rgbn(n);
    if (l === 3) {
      return [
        ((n >> 8) & 0xf) | ((n >> 4) & 0xf0),
        ((n >> 4) & 0xf) | (n & 0xf0),
        ((n & 0xf) << 4) | (n & 0xf),
        1,
      ];
    }
    if (l === 8) {
      return rgba(
        (n >> 24) & 0xff,
        (n >> 16) & 0xff,
        (n >> 8) & 0xff,
        (n & 0xff) / 0xff
      );
    }
    if (l === 4) {
      return rgba(
        ((n >> 12) & 0xf) | ((n >> 8) & 0xf0),
        ((n >> 8) & 0xf) | ((n >> 4) & 0xf0),
        ((n >> 4) & 0xf) | (n & 0xf0),
        (((n & 0xf) << 4) | (n & 0xf)) / 0xff
      );
    }
    return undefined;
  }
  const pct = (s: string) => (Number(s) * 255) / 100;
  if ((m = reRgbInteger.exec(format))) {
    return [Number(m[1]), Number(m[2]), Number(m[3]), 1];
  }
  if ((m = reRgbPercent.exec(format))) {
    return [pct(m[1]), pct(m[2]), pct(m[3]), 1];
  }
  if ((m = reRgbaInteger.exec(format))) {
    return rgba(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
  }
  if ((m = reRgbaPercent.exec(format))) {
    return rgba(pct(m[1]), pct(m[2]), pct(m[3]), Number(m[4]));
  }
  if ((m = reHslPercent.exec(format))) {
    return hsla(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100, 1);
  }
  if ((m = reHslaPercent.exec(format))) {
    return hsla(
      Number(m[1]),
      Number(m[2]) / 100,
      Number(m[3]) / 100,
      Number(m[4])
    );
  }
  if (Object.prototype.hasOwnProperty.call(NAMED, format)) {
    return rgbn(NAMED[format]);
  }
  if (format === 'transparent') return [NaN, NaN, NaN, 0];
  return undefined;
}

const clampi = (v: number) => Math.max(0, Math.min(255, Math.round(v) || 0));
const clampa = (a: number) =>
  Number.isNaN(a) ? 1 : Math.max(0, Math.min(1, a));

/**
 * One channel of `interpolateRgb`: linear from `a` to `b`, else constant
 * when they are equal or `a` is unset (from `transparent`, the colour comes
 * from `b` and only the opacity changes).
 */
const lerp = (a: number, b: number, t: number): number => {
  const d = b - a;
  return d ? a + t * d : Number.isNaN(a) ? b : a;
};

/**
 * The colour `t` of the way from `a` to `b` (a `t` outside 0-1
 * extrapolates, clamped per channel), printed as d3 prints it.
 */
export function interpolateRgba(a: Rgba, b: Rgba, t: number): string {
  const [r, g, bl] = [0, 1, 2].map((c) => clampi(lerp(a[c], b[c], t)));
  const alpha = clampa(lerp(a[3], b[3], t));
  return alpha === 1
    ? `rgb(${r}, ${g}, ${bl})`
    : `rgba(${r}, ${g}, ${bl}, ${alpha})`;
}
