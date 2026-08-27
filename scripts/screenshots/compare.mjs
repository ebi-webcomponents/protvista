/**
 * Tolerant image comparison.
 *
 * Most shots are byte-exact: identical pixels re-encode identically, so any
 * difference — on the same machine — is a real change. Across machines it is
 * not that simple: text rasterisation alone moves ~2% of the pixels, which is
 * why `--check` draws what differs instead of only counting it (see README).
 * The 3D structure viewer is not byte-exact anywhere — Mol* settles to
 * a marginally different anti-aliasing on every run (measured: ~0.3% of pixels,
 * max channel delta 42, with no perceptible change). Comparing those bytes
 * would rewrite the file on every capture and bury genuine changes in churn.
 *
 * So a shot may declare a `tolerance`, and this decides whether two images are
 * "the same picture". Used for three things: whether to rewrite a file, whether
 * `--check` reports drift, and whether `--assert-clean` considers a shot
 * reproducible.
 */
import sharp from 'sharp';

/**
 * How much of the picture differs, and — optionally — a picture of where.
 *
 * One pass, because the two questions have the same loop: `--check` wants both
 * at once and these images run to seven megapixels.
 *
 * `heatmap` returns the differing pixels in red on white. That is the part a
 * reviewer actually reads: drift that traces every glyph and leaves the tracks
 * untouched is the text rasteriser differing between two machines, while drift
 * with a shape to it is the UI having moved. The number alone cannot tell those
 * apart — measured between the committed images and a Linux runner, pure
 * rasterisation noise reaches 1.8% of pixels with per-channel deltas at the
 * full 255.
 */
export async function drift(a, b, { channelDelta = 8, heatmap = false } = {}) {
  const [ra, rb] = await Promise.all([
    sharp(a).raw().toBuffer({ resolveWithObject: true }),
    sharp(b).raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (
    ra.info.width !== rb.info.width ||
    ra.info.height !== rb.info.height ||
    ra.info.channels !== rb.info.channels
  ) {
    // Different dimensions is always a real change, and there is no pixel
    // correspondence to draw.
    return { fraction: 1, resized: true, heatmap: null };
  }
  const { width, height, channels: ch } = ra.info;
  const heat = heatmap ? Buffer.alloc(width * height * 3, 0xff) : null;
  let differing = 0;
  for (let i = 0, px = 0; i < ra.data.length; i += ch, px++) {
    let d = 0;
    for (let c = 0; c < Math.min(3, ch); c++) {
      const delta = Math.abs(ra.data[i + c] - rb.data[i + c]);
      if (delta > d) d = delta;
    }
    if (d > channelDelta) {
      differing++;
      if (heat) heat[px * 3 + 1] = heat[px * 3 + 2] = 0; // red
    }
  }
  return {
    fraction: differing / (width * height),
    resized: false,
    heatmap: heat
      ? await sharp(heat, { raw: { width, height, channels: 3 } })
          .png()
          .toBuffer()
      : null,
  };
}

/**
 * Is the whole image one flat colour?
 *
 * Asked of the 3D canvas, which can mount at full size and paint nothing (see
 * `assertStructurePainted` in ready.mjs). Nothing else in the harness notices
 * that: flat pixels are perfectly *stable* pixels, and they compare equal to
 * themselves on every run. A real render — even a small molecule on a plain
 * background — moves the per-channel standard deviation well clear of zero,
 * while an unpainted canvas sits exactly at it.
 */
export async function isUniform(png, { maxStdev = 0.5 } = {}) {
  const { channels } = await sharp(png).stats();
  return channels.every((c) => c.stdev <= maxStdev);
}

/** Fraction of pixels differing by more than `channelDelta` per channel. */
export async function pixelDelta(a, b, opts) {
  return (await drift(a, b, opts)).fraction;
}

/**
 * Are these the same picture? Byte equality first — the common case, and free.
 */
export async function sameImage(a, b, tolerance = 0) {
  if (a.equals(b)) return { same: true, delta: 0 };
  if (!tolerance) return { same: false, delta: null };
  const delta = await pixelDelta(a, b);
  return { same: delta <= tolerance, delta };
}
