/**
 * PNG encoding and the size budget.
 *
 * Chromium's PNG encoder is not stable across builds, so identical pixels can
 * still produce different bytes and dirty the git diff. Re-encoding every
 * buffer through sharp with fixed options makes the output a function of the
 * pixels alone, which is what lets `--assert-clean` mean anything.
 *
 * sharp is already a devDependency (Astro's image service uses it), so this
 * adds nothing to install.
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Warn above this, fail above the hard cap. Docs images should stay light. */
export const WARN_BYTES = 300 * 1024;
export const MAX_BYTES = 500 * 1024;

export async function encode(buffer, shot) {
  let img = sharp(buffer);

  // Captured at deviceScaleFactor 2 for crisp text; `resizeTo` lets a shot
  // declare its final pixel size (the Starlight hero, for instance, is
  // rendered at exactly 400x400 and must arrive square).
  if (shot.resizeTo) {
    img = img.resize(shot.resizeTo.width, shot.resizeTo.height, {
      fit: 'cover',
      position: shot.resizeTo.position ?? 'centre',
    });
  }

  // `palette` quantises to 256 colours, which suits flat UI screenshots and
  // roughly halves the file. A shot showing a continuous colour ramp can turn
  // it off.
  const out = await img
    .png({
      compressionLevel: 9,
      effort: 10,
      palette: shot.palette !== false,
      colours: 256,
      dither: 0,
    })
    .toBuffer();

  return out;
}

/**
 * Join captures side by side, for shots that only make sense as a comparison.
 *
 * Heights are padded to the tallest frame rather than scaled, so the two halves
 * stay pixel-comparable — the whole point of a before/after is that the only
 * visible difference is the one being demonstrated.
 */
export async function join(buffers, { gap = 24, background = '#ffffff' } = {}) {
  const metas = await Promise.all(buffers.map((b) => sharp(b).metadata()));
  const height = Math.max(...metas.map((m) => m.height));
  const width =
    metas.reduce((sum, m) => sum + m.width, 0) + gap * (buffers.length - 1);

  let x = 0;
  const composite = buffers.map((input, i) => {
    const left = x;
    x += metas[i].width + gap;
    return { input, left, top: 0 };
  });

  return sharp({
    create: { width, height, channels: 3, background },
  })
    .composite(composite)
    .png()
    .toBuffer();
}

export function write(path, buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

export function checkSize(id, bytes) {
  if (bytes > MAX_BYTES) {
    throw new Error(
      `${id}: ${(bytes / 1024).toFixed(0)} KB exceeds the ${MAX_BYTES / 1024} KB hard cap`
    );
  }
  return bytes > WARN_BYTES
    ? `${id}: ${(bytes / 1024).toFixed(0)} KB is over the ${WARN_BYTES / 1024} KB budget`
    : null;
}
