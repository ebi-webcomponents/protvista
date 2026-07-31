/**
 * Tolerant image comparison.
 *
 * Most shots are byte-exact: identical pixels re-encode identically, so any
 * difference is a real change. The 3D structure viewer is not — Mol* settles to
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

/** Fraction of pixels differing by more than `channelDelta` per channel. */
export async function pixelDelta(a, b, { channelDelta = 8 } = {}) {
  const [ra, rb] = await Promise.all([
    sharp(a).raw().toBuffer({ resolveWithObject: true }),
    sharp(b).raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (
    ra.info.width !== rb.info.width ||
    ra.info.height !== rb.info.height ||
    ra.info.channels !== rb.info.channels
  ) {
    return 1; // different dimensions is always a real change
  }
  const ch = ra.info.channels;
  let differing = 0;
  for (let i = 0; i < ra.data.length; i += ch) {
    let d = 0;
    for (let c = 0; c < Math.min(3, ch); c++) {
      const delta = Math.abs(ra.data[i + c] - rb.data[i + c]);
      if (delta > d) d = delta;
    }
    if (d > channelDelta) differing++;
  }
  return differing / (ra.info.width * ra.info.height);
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
