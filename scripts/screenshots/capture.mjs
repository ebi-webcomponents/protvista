/**
 * Regenerates the documentation screenshots.
 *
 *   yarn screenshots                     capture everything
 *   yarn screenshots --only=id,id        capture a subset
 *   yarn screenshots --check             report drift, write nothing
 *   yarn screenshots --assert-clean      capture twice, fail if unstable
 *   yarn screenshots --refresh-fixtures  re-record the pinned network payloads
 *   yarn screenshots --no-build          reuse the existing site/ build
 *
 * See README.md for how the pieces fit together and how to add a shot.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { startServer } from './server.mjs';
import { installRoutes, createLedger } from './router.mjs';
import {
  watchConsole,
  waitForViewer,
  assertGroups,
  assertCapturable,
  clipRect,
  captureStable,
} from './ready.mjs';
import { encode, write, checkSize, join } from './encode.mjs';
import { sameImage, drift } from './compare.mjs';
import { byId, outPath, DEFAULT_TOLERANCE } from './manifest.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => argv.find((a) => a.startsWith(`${f}=`))?.split('=')[1];

const CHECK = has('--check');
const ASSERT_CLEAN = has('--assert-clean');
const ONLY = val('--only')?.split(',').filter(Boolean);

/** Where `--check` leaves its evidence. Gitignored, and uploaded by CI: a
 *  percentage says how much moved, only the picture says what. */
const DRIFT_DIR = val('--drift-dir') ?? 'screenshot-drift';

/** Read the prefix from source rather than hardcoding `pv-cecb45`: the class
 *  names are explicitly outside the compatibility contract, so a harness that
 *  embedded the literal would silently stop finding its targets. */
const CSS_PREFIX = /export const CSS_PREFIX = '([^']+)'/.exec(
  readFileSync('src/styles/css-prefix.ts', 'utf8')
)[1];

if (has('--refresh-fixtures')) {
  const { recordFixtures } = await import('./record.mjs');
  await recordFixtures();
  process.exit(0);
}

if (!has('--no-build')) {
  console.log('building site/ …');
  try {
    execFileSync(
      'node',
      ['node_modules/.bin/astro', 'build', '--root', 'docs'],
      { stdio: 'inherit' }
    );
  } catch (e) {
    // Judge the build by its output, not its exit code. Starlight's Pagefind
    // step runs after the pages are written and fails in some environments for
    // reasons unrelated to the site (its Rust binary aborts where the host page
    // size is unusual). The pages we photograph are already on disk by then, so
    // rather than blocking a capture on the search index, check what matters
    // and rethrow if it is genuinely absent.
    if (!existsSync('site/playground/index.html')) throw e;
    console.warn(
      'warning: astro build exited non-zero but the pages were written ' +
        '(likely the Pagefind step); continuing.'
    );
  }
}

const selected = byId(ONLY);
const { baseURL, stop } = await startServer();
/**
 * Two browsers, launched on demand.
 *
 * Headless Chromium refuses Mol*'s WebGL context request unless SwiftShader is
 * forced ("Could not create a WebGL rendering context"), after which it gives
 * up before even fetching a model and the 3D pane renders silently blank. But
 * forcing it is *not* harmless elsewhere: with those flags the Nightingale
 * track canvases never stop redrawing, so ordinary shots never reach pixel
 * stability. Only a shot that asks for the structure pane gets them.
 */
const browsers = {};
const GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];
async function browserFor(shot) {
  const key = shot.structure ? 'gl' : 'default';
  browsers[key] ??= await chromium.launch(
    shot.structure ? { args: GL_ARGS } : {}
  );
  return browsers[key];
}

/** One capture pass over one shot, in its own context. A fresh context per shot
 *  is not tidiness: the playground persists layout to localStorage and mirrors
 *  it into `?layout=`, so a reused profile would silently change what renders. */
async function capture(shot, frame = shot) {
  const context = await (await browserFor(shot)).newContext({
    viewport: shot.viewport,
    deviceScaleFactor: 2,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });

  // Kill motion and focus rings before any script runs. `!important` beats the
  // component's own rules regardless of order — needed because at least one
  // transition (the caret's `all 0.1s`) sits outside `prefers-reduced-motion`.
  await context.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = `*,*::before,*::after{
      animation-duration:0s!important;animation-delay:0s!important;
      transition-duration:0s!important;transition-delay:0s!important;
      caret-color:transparent!important}
      :focus-visible{outline:none!important}`;
    const attach = () => document.documentElement.append(style);
    if (document.documentElement) attach();
    else document.addEventListener('DOMContentLoaded', attach);
  });

  const ledger = createLedger();
  await installRoutes(context, { baseURL, ledger, structure: shot.structure });

  const page = await context.newPage();
  const consoleProblems = watchConsole(page);

  await page.goto(`${baseURL}${frame.url}`, { waitUntil: 'load' });
  await waitForViewer(page, CSS_PREFIX);

  for (const action of shot.actions ?? []) {
    if (action.clickRole) {
      await page
        .getByRole(action.clickRole.role, { name: action.clickRole.name })
        .first()
        .click();
      // The row subtree is rebuilt on entering customize mode, so re-settle
      // rather than assuming the pre-click readiness still holds.
      await waitForViewer(page, CSS_PREFIX);
    }
  }

  // Hide anything the shot declares, before measuring — hiding reflows the
  // page. This exists for one reason: the 3D pane is stubbed away for
  // determinism (see router.mjs), which leaves it rendering "No structure
  // information available". That message is an artefact of the harness, not
  // something a reader would see, so a figure that would otherwise include it
  // hides the pane rather than publishing a false empty state.
  if (shot.hide?.length) {
    await page.addStyleTag({
      content: `${shot.hide.join(',')}{display:none!important}`,
    });
  }

  // Only now: interactions can legitimately change which rows are revealed.
  await assertGroups(page, CSS_PREFIX, frame.expectGroups ?? shot.expectGroups);
  await assertCapturable(page, ledger, consoleProblems, {
    structure: shot.structure,
  });

  const clip = await clipRect(page, shot);
  // Fit the viewport to the content so Playwright does not take the
  // `captureBeyondViewport` path, which resizes the compositing surface and
  // makes the canvases redraw mid-capture.
  if (clip.height + clip.y > shot.viewport.height) {
    await page.setViewportSize({
      width: shot.viewport.width,
      height: Math.ceil(clip.height + clip.y + 40),
    });
    await waitForViewer(page, CSS_PREFIX);
  }

  const raw = await captureStable(page, await clipRect(page, shot));
  await context.close();
  return raw;
}

/** A shot is either one capture, or several joined into a comparison. */
async function render(shot) {
  if (shot.frames) {
    const frames = [];
    for (const frame of shot.frames) frames.push(await capture(shot, frame));
    return encode(await join(frames), shot);
  }
  return encode(await capture(shot), shot);
}

/**
 * What `--check` leaves behind for whoever reads the failure: the fresh bytes,
 * and the committed image, the fresh one and the difference joined into a
 * single strip. Reviewers see this as a CI artifact, so it has to answer "is
 * this a real change?" on its own.
 */
async function writeComparison(id, committed, fresh, heatmap) {
  write(`${DRIFT_DIR}/${id}.fresh.png`, fresh);
  // Nothing to compare against for a shot that has never been committed, and
  // nothing to draw when the two differ in size — the fresh bytes are the whole
  // story in both cases.
  if (!committed) return;
  write(
    `${DRIFT_DIR}/${id}.compare.png`,
    await join(heatmap ? [committed, fresh, heatmap] : [committed, fresh], {
      gap: 16,
      background: '#808080',
    })
  );
}

let failures = 0;
let drifted = 0;
const warnings = [];

for (const shot of selected) {
  const path = outPath(shot.id);
  process.stdout.write(`  ${shot.id} … `);
  try {
    const png = await render(shot);

    if (ASSERT_CLEAN) {
      const again = await render(shot);
      const { same, delta } = await sameImage(png, again, shot.tolerance);
      if (!same) {
        throw new Error(
          'two consecutive captures differ — output is not reproducible' +
            (delta === null ? '' : ` (${(delta * 100).toFixed(3)}% of pixels)`)
        );
      }
    }

    const warn = checkSize(shot.id, png.length);
    if (warn) warnings.push(warn);

    // Comparing across machines, so the lenient default applies unless the shot
    // asks for something tighter (the 3D shots do). `--assert-clean` above
    // stays on the shot's own tolerance: that one compares two captures from
    // *this* machine, where disagreement is a defect rather than noise.
    const tolerance = shot.tolerance ?? DEFAULT_TOLERANCE;
    const existing = existsSync(path) ? readFileSync(path) : null;
    const { same } = existing
      ? await sameImage(existing, png, tolerance)
      : { same: false };

    if (CHECK) {
      if (!existing) {
        console.log(`MISSING (${(png.length / 1024).toFixed(0)} KB would be written)`);
        await writeComparison(shot.id, null, png, null);
        drifted++;
      } else if (!same) {
        // Kilobytes were never the question — a shot can gain a whole row and
        // lose weight. Measure what actually moved, and draw it.
        const { fraction, resized, heatmap } = await drift(existing, png, {
          heatmap: true,
        });
        console.log(
          resized
            ? `DRIFTED (dimensions changed, ${(existing.length / 1024).toFixed(0)} KB → ${(png.length / 1024).toFixed(0)} KB)`
            : `DRIFTED (${(fraction * 100).toFixed(2)}% of pixels, over the ${(tolerance * 100).toFixed(0)}% tolerance)`
        );
        await writeComparison(shot.id, existing, png, heatmap);
        drifted++;
      } else {
        console.log('unchanged');
      }
    } else if (same) {
      // Visually identical to what is committed. Leave the file alone rather
      // than rewriting it — otherwise a shot with a tolerance (the 3D viewer)
      // would dirty the diff on every run for no visible reason.
      console.log('unchanged');
    } else {
      write(path, png);
      console.log(`${(png.length / 1024).toFixed(0)} KB → ${path}`);
    }
  } catch (e) {
    failures++;
    console.log('FAILED');
    console.error(`\n${e.message}\n`);
  }
}

await Promise.all(Object.values(browsers).map((b) => b.close()));
stop();

for (const w of warnings) console.warn(`warning: ${w}`);

if (failures) {
  console.error(`\n${failures}/${selected.length} shot(s) failed.`);
  process.exit(1);
}
if (CHECK && drifted) {
  console.error(
    `\n${drifted}/${selected.length} image(s) differ from what is committed.\n` +
      `  ${DRIFT_DIR}/<id>.compare.png   committed | fresh | difference\n` +
      `  ${DRIFT_DIR}/<id>.fresh.png     the new bytes, if the change is wanted\n` +
      `The tolerance already absorbs cross-machine text rasterisation, so this ` +
      `moved further than that. Look before regenerating with ` +
      `\`yarn screenshots\`.`
  );
  process.exit(1);
}
console.log(`\n${selected.length} shot(s) ok.`);
