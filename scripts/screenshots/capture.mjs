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
import { byId, outPath } from './manifest.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => argv.find((a) => a.startsWith(`${f}=`))?.split('=')[1];

const CHECK = has('--check');
const ASSERT_CLEAN = has('--assert-clean');
const ONLY = val('--only')?.split(',').filter(Boolean);

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
const browser = await chromium.launch();

/** One capture pass over one shot, in its own context. A fresh context per shot
 *  is not tidiness: the playground persists layout to localStorage and mirrors
 *  it into `?layout=`, so a reused profile would silently change what renders. */
async function capture(shot, frame = shot) {
  const context = await browser.newContext({
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
  await installRoutes(context, { baseURL, ledger });

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
  await assertCapturable(page, ledger, consoleProblems);

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

let failures = 0;
let drift = 0;
const warnings = [];

for (const shot of selected) {
  const path = outPath(shot.id);
  process.stdout.write(`  ${shot.id} … `);
  try {
    const png = await render(shot);

    if (ASSERT_CLEAN) {
      const again = await render(shot);
      if (!png.equals(again)) {
        throw new Error(
          'two consecutive captures differ — output is not reproducible'
        );
      }
    }

    const warn = checkSize(shot.id, png.length);
    if (warn) warnings.push(warn);

    if (CHECK) {
      const existing = existsSync(path) ? readFileSync(path) : null;
      if (!existing) {
        console.log(`MISSING (${(png.length / 1024).toFixed(0)} KB would be written)`);
        drift++;
      } else if (!existing.equals(png)) {
        console.log(`DRIFTED (${(existing.length / 1024).toFixed(0)} KB → ${(png.length / 1024).toFixed(0)} KB)`);
        drift++;
      } else {
        console.log('unchanged');
      }
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

await browser.close();
stop();

for (const w of warnings) console.warn(`warning: ${w}`);

if (failures) {
  console.error(`\n${failures}/${selected.length} shot(s) failed.`);
  process.exit(1);
}
if (CHECK && drift) {
  console.error(
    `\n${drift}/${selected.length} image(s) differ from what is committed. ` +
      `Regenerate with \`yarn screenshots\`.`
  );
  process.exit(1);
}
console.log(`\n${selected.length} shot(s) ok.`);
