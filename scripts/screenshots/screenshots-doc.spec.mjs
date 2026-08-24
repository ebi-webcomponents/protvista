/**
 * Drift test between the screenshot manifest and the docs that display the
 * images, in the same spirit as `src/__spec__/tutorial-doc.spec.ts`.
 *
 * The harness owns the alt text and captions, because they are reviewed
 * alongside the image they describe. Nothing otherwise stops the markdown and
 * the manifest disagreeing: an image could be re-shot to show something
 * different while the prose beside it still described the old picture, and
 * `astro build` would be perfectly happy.
 *
 * It lives here rather than under `src/` because it tests the harness, not the
 * library — and because `tsconfig.json` sets `rootDir: "./src"` precisely so
 * that nothing under `src/` reaches into build tooling. Co-locating the spec
 * with the manifest it validates respects that boundary instead of working
 * around it.
 *
 * Runs in the ordinary unit suite (see `vite.config.mjs`) — no browser, no
 * capture — so the relationship is checked on every push rather than only when
 * someone regenerates the images.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { shots, outPath } from './manifest.mjs';
import { structureUrls } from './seeds.mjs';
import { loadIndex } from './fixtures.mjs';

const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const exists = (rel) => existsSync(resolve(process.cwd(), rel));

describe('documentation screenshots match their manifest', () => {
  it('every shot has descriptive alt text', () => {
    for (const shot of shots) {
      expect(shot.alt, `${shot.id} has no alt text`).toBeTruthy();
      // "Screenshot of ProtVista" tells a screen-reader user nothing. Real
      // descriptions of these views do not fit in a handful of words.
      expect(
        shot.alt.length,
        `${shot.id}: alt text is too short to describe the image`
      ).toBeGreaterThan(40);
    }
  });

  it('every captured image exists on disk', () => {
    const missing = shots.map((s) => outPath(s.id)).filter((p) => !exists(p));
    expect(
      missing,
      'run `yarn screenshots` to regenerate the missing image(s)'
    ).toEqual([]);
  });

  it('each doc references its image with the manifest alt text', () => {
    for (const shot of shots.filter((s) => s.doc && !s.hero)) {
      const doc = read(shot.doc);
      // A shot may write outside the docs asset tree (the README image is
      // resolved by GitHub and npm, not by the site build), so match on the
      // file the manifest actually produces.
      expect(doc, `${shot.doc} does not reference ${outPath(shot.id)}`).toContain(
        basename(outPath(shot.id))
      );
      expect(
        doc,
        `${shot.doc} does not carry the manifest alt text for ${shot.id}`
      ).toContain(`![${shot.alt}]`);
    }
  });

  it('each doc carries the manifest caption', () => {
    for (const shot of shots.filter((s) => s.doc && !s.hero && s.caption)) {
      expect(
        read(shot.doc),
        `${shot.doc} does not carry the manifest caption for ${shot.id}`
      ).toContain(shot.caption);
    }
  });

  it('the splash hero is wired through frontmatter, not the body', () => {
    const hero = shots.find((s) => s.hero);
    if (!hero) return;
    const doc = read(hero.doc);
    // Starlight renders the splash hero from `hero.image`; a body image would
    // appear below the fold instead, and `hero.image.file` must resolve to a
    // real project file (a `/protvista/...` URL fails schema validation).
    expect(doc).toContain(`file: ../../assets/screenshots/${hero.id}.png`);
    expect(doc).toContain(`alt: ${hero.alt}`);
  });

  it('every 3D shot pins the structure it photographs', () => {
    // Otherwise the figure is of whichever entry the pane sorts first, which is
    // a property of continuously curated data and of code free to reorder it —
    // neither of which the caption beside the image knows about. See
    // PINNED_STRUCTURE in manifest.mjs.
    for (const shot of shots.filter((s) => s.structure)) {
      expect(
        shot.structureId,
        `${shot.id} shows the 3D pane but does not pin a structureId`
      ).toBeTruthy();
    }
  });

  it('every pinned structure has its fixtures recorded', () => {
    // The browser-based capture would catch this too, by aborting an unpinned
    // request — but only where a browser can run. Here it costs nothing and
    // fails in the ordinary unit suite, naming the URLs to record.
    const index = loadIndex();
    const missing = [
      ...new Set(shots.filter((s) => s.structureId).map((s) => s.structureId)),
    ].flatMap((id) => structureUrls(id).filter((url) => !index[url]));
    expect(
      missing,
      `record with: node scripts/screenshots/record-cli.mjs ${missing
        .map((u) => `"${u}"`)
        .join(' ')}`
    ).toEqual([]);
  });

  it('no TODO(screenshot) marker survives for a captured shot', () => {
    const docs = [...new Set(shots.map((s) => s.doc).filter(Boolean))];
    for (const doc of docs) {
      expect(read(doc), `${doc} still has a TODO(screenshot)`).not.toContain(
        'TODO(screenshot)'
      );
    }
  });
});
