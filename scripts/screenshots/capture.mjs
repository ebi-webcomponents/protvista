/**
 * Regenerates the documentation screenshots.
 *
 *   yarn screenshots                     capture everything
 *   yarn screenshots --only=id,id        capture a subset
 *   yarn screenshots --check             report drift, write nothing
 *   yarn screenshots --assert-clean      capture twice, fail if unstable
 *   yarn screenshots --refresh-fixtures  re-record the pinned network payloads
 *   yarn screenshots --record-missing    pin whatever a run found unpinned
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
  assertNothingUnpinned,
  clipRect,
  captureStable,
} from './ready.mjs';
import { encode, write, checkSize, join } from './encode.mjs';
import { sameImage, drift } from './compare.mjs';
import { byId, outPath, TOLERANCE } from './manifest.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => argv.find((a) => a.startsWith(`${f}=`))?.split('=')[1];

const CHECK = has('--check');
const ASSERT_CLEAN = has('--assert-clean');
const RECORD_MISSING = has('--record-missing');
const ONLY = val('--only')?.split(',').filter(Boolean);

/** Every URL the run reached for that no fixture had, across all shots. */
const unpinnedAcrossRun = new Set();

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

  // Pin which structure the 3D pane shows, so the figure does not depend on how
  // the pane happens to order UniProt's PDB cross-references (see
  // PINNED_STRUCTURE in manifest.mjs). `selected-id` must be set *before* the
  // pane's own fetch resolves, since it only defaults to the first row when the
  // consumer has not chosen — the observer runs a microtask after the element
  // is inserted, long before any network settles. `document` is observed rather
  // than `documentElement`, which may not exist yet when init scripts run.
  if (shot.structureId) {
    await context.addInitScript((id) => {
      const pin = (el) => {
        if (!el.hasAttribute('selected-id')) el.setAttribute('selected-id', id);
      };
      const scan = (node) => {
        if (node.nodeType !== 1) return;
        if (node.localName === 'protvista-uniprot-structure') pin(node);
        node.querySelectorAll?.('protvista-uniprot-structure').forEach(pin);
      };
      new MutationObserver((records) => {
        for (const record of records) record.addedNodes.forEach(scan);
      }).observe(document, { childList: true, subtree: true });
    }, shot.structureId);
  }

  const ledger = createLedger();
  await installRoutes(context, { baseURL, ledger, structure: shot.structure });

  // Sequenced by hand rather than `try`/`finally` because the order is the
  // point, and the last step has to be able to fail the shot. The ledger is
  // only complete once the context is gone, and all of it must happen before
  // `capture()` returns: a png that reaches the caller is a png the caller
  // writes.
  let png;
  let captureError;
  try {
    png = await capturePage(context, ledger, shot, frame);
  } catch (e) {
    captureError = e;
  }
  // Reported, not thrown: a context whose browser has already gone rejects
  // on close, and letting that propagate would replace the error that
  // actually explains the failure with one about tidying up after it.
  await context
    .close()
    .catch((e) => console.error(`\nclosing the context failed: ${e.message}`));
  // Harvested *after* the close, because a request still in flight when the
  // page goes lands in the ledger during teardown. Whatever went wrong, keep
  // what this shot reached for that no fixture had: the run prints one
  // paste-ready record command at the end rather than leaving each failure to
  // be read and retyped separately.
  for (const url of ledger.unpinned) unpinnedAcrossRun.add(url);
  if (captureError) throw captureError;
  // Nothing has thrown for a url that arrived during teardown: it landed after
  // `capturePage`'s last check, with the page already going down. Failing here
  // — before the png is handed back, and so before anything can write it — is
  // what keeps a picture drawn without that response off disk. The alternative
  // is writing the file and then asking whoever reads the log to distrust it.
  assertNothingUnpinned(ledger);
  return png;
}

/** The pass itself: everything from opening the page to stable pixels. Split
 *  out so `capture()` can own the context's lifetime and its ledger. */
async function capturePage(context, ledger, shot, frame) {
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
    structureId: shot.structureId,
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

  const png = await captureStable(page, await clipRect(page, shot));
  // Once more, now that the pixels have stopped moving: the settle loop runs
  // after every gate above, so a request no fixture pins can still be refused
  // while the picture is being taken. Failing here is what keeps that picture
  // off disk — a warning printed at the end of the run arrives after the file
  // has already been written.
  assertNothingUnpinned(ledger);
  return png;
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
      const { same, delta } = await sameImage(png, again, TOLERANCE);
      if (!same) {
        throw new Error(
          'two consecutive captures differ — output is not reproducible' +
            (delta === null ? '' : ` (${(delta * 100).toFixed(3)}% of pixels)`)
        );
      }
    }

    const warn = checkSize(shot.id, png.length);
    if (warn) warnings.push(warn);

    const existing = existsSync(path) ? readFileSync(path) : null;
    const { same } = existing
      ? await sameImage(existing, png, TOLERANCE)
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
            : `DRIFTED (${(fraction * 100).toFixed(2)}% of pixels, over the ${(TOLERANCE * 100).toFixed(0)}% tolerance)`
        );
        await writeComparison(shot.id, existing, png, heatmap);
        drifted++;
      } else {
        console.log('unchanged');
      }
    } else if (same) {
      // Visually identical to what is committed. Leave the file alone rather
      // than rewriting it — otherwise the 3D shots, which never settle to the
      // same pixels twice, would dirty the diff on every run for no visible
      // reason.
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

/**
 * Unpinned URLs, gathered once for the whole run.
 *
 * Reaching one always fails the *shot* — `ready.mjs` checks before the gates
 * and while the 3D pane resolves, `capturePage` checks again once the pixels
 * have settled, and `capture` checks once more after the context is gone, for
 * anything that arrived during teardown. So this is not the news, only the
 * record: *which* URLs, collected into one command.
 *
 * Recording is deliberately not automatic. A URL that appears without the
 * fixtures having changed means the code changed what the viewer fetches, and
 * that is worth looking at before pinning it.
 */
if (unpinnedAcrossRun.size) {
  const urls = [...unpinnedAcrossRun];
  if (RECORD_MISSING) {
    const { recordFixtures } = await import('./record.mjs');
    await recordFixtures(urls);
    console.error(`\nRecorded ${urls.length} url(s). Re-run to capture with them pinned.`);
  } else {
    console.error(
      `\n${urls.length} url(s) were requested and are not pinned:\n` +
        urls.map((u) => `  ${u}`).join('\n') +
        `\nIf the viewer is meant to ask for these, pin them:\n\n` +
        `  yarn screenshots --record-missing --no-build${ONLY ? ` --only=${ONLY.join(',')}` : ''}\n\n` +
        `If the fixtures did not change, the *code* changed what the viewer\n` +
        `fetches — a different structure, source or endpoint. Check that the\n` +
        `figure still shows what its caption claims before recording.`
    );
  }
}

/**
 * Two kinds of bad news, two exit codes, because they deserve different
 * answers. **1** — a shot could not be captured at all: an unpinned request, a
 * page error, a viewer that did not render. Something is broken, and no image
 * can be regenerated until it is fixed. **2** — every shot captured, but the
 * pictures moved. That is a judgement call for whoever reads the diff strip,
 * and on a pull request it is advisory (see .github/workflows/screenshots.yml).
 */
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
  process.exit(2);
}
console.log(`\n${selected.length} shot(s) ok.`);
