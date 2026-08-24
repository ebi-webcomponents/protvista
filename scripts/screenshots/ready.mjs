/**
 * Readiness gates and failure detectors.
 *
 * The viewer renders asynchronously from a dozen fetches, so "is it finished?"
 * has no single answer. There are no bare timeouts here: every wait is a
 * condition with a bounded number of polls, and anything that cannot be
 * established fails the run rather than producing an image nobody can trust.
 *
 * The gates are layered because no single one is sufficient. In particular the
 * `protvista:first-render` performance mark — the component's documented
 * readiness signal — is *not* enough on its own: measured on the `csv` preset,
 * it fires as soon as track data arrives, while the top-level sequence fetch is
 * still in flight and `render()` is still returning empty. A capture gated only
 * on the mark photographs a blank element.
 */

/** Poll `fn` until it returns truthy. Bounded; throws with context on failure. */
async function until(page, label, fn, { tries = 120, everyMs = 250 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (last) return last;
    await page.waitForTimeout(everyMs);
  }
  throw new Error(
    `readiness gate "${label}" never became true after ${(tries * everyMs) / 1000}s` +
      (last === undefined ? '' : ` (last value: ${JSON.stringify(last)})`)
  );
}

/**
 * Console output that is expected and must not fail a run.
 *
 * - The negative-`<rect>`-width errors come from a Nightingale track drawing
 *   during layout; they predate this harness and appear on a healthy viewer.
 * - The `rna-editing` 404 is real UniProt behaviour for this accession, faithfully
 *   replayed from the fixture. Reproducing the viewer means reproducing it.
 */
const EXPECTED_CONSOLE = [
  /<rect> attribute width: A negative value is not valid/,
  /HTTP error status: 404 at .*proteins\/api\/rna-editing/,
  /Failed to load resource: the server responded with a status of 404/,
];

export function watchConsole(page) {
  const problems = [];
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() !== 'error' && !/^Failed to (fetch|parse|read)/.test(text)) {
      return;
    }
    if (EXPECTED_CONSOLE.some((re) => re.test(text))) return;
    problems.push(`console.${m.type()}: ${text.slice(0, 200)}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

/**
 * Wait for the viewer to be genuinely painted.
 *
 * This only establishes *settled*, never *correct*: a shot's `expectGroups` is
 * checked separately by `assertGroups`, after any interactions have run. The
 * separation matters — entering Customize mode changes which rows are revealed
 * (errored rows are shown so their badge stays reachable), so asserting the
 * post-click expectation against the pre-click DOM would fail on a healthy page.
 */
export async function waitForViewer(page, prefix) {
  // 1. Real content exists. This is the gate the perf mark cannot provide: it
  //    distinguishes a mounted, populated viewer from the transient (and
  //    persistent-on-failure) empty render.
  await until(page, 'nightingale-manager present', () =>
    page.evaluate(
      () => !!document.querySelector('protvista-uniprot nightingale-manager')
    )
  );

  // 2. The component says it has painted.
  await until(page, 'protvista:first-render mark', () =>
    page.evaluate(
      () =>
        performance.getEntriesByName('protvista:first-render', 'mark').length > 0
    )
  );

  // 3. The expected rows are not merely present but *revealed*. Groups are
  //    `display:none` until their data lands, so this is the true "data
  //    painted" signal.
  //
  //    Wait for the set to stop *changing*, not merely to reach a size. Rows
  //    reveal in two waves: those with data, then (a tick later) those with a
  //    visible fetch error, which are revealed so their ⚠ badge is not hidden.
  //    Sampling between the waves is a real race — it produced two different
  //    group sets from the same URL in one run before this settle-wait existed.
  const readGroups = () =>
    page.evaluate(
      (p) =>
        [...document.querySelectorAll(`div[id^="${p}-group_"]`)]
          .filter((g) => getComputedStyle(g).display !== 'none')
          .map((g) => g.id.slice(`${p}-group_`.length))
          .sort(),
      prefix
    );

  await until(page, 'group set settles', async () => {
    const a = JSON.stringify(await readGroups());
    await page.waitForTimeout(200);
    const b = JSON.stringify(await readGroups());
    return a === b && JSON.parse(a).length > 0;
  });

  // 4. Fonts. Text metrics shift when a webfont swaps in.
  await page.evaluate(() => document.fonts.ready);

  // 5. Every canvas has real dimensions (a 0×0 canvas paints nothing).
  await until(page, 'canvases sized', () =>
    page.evaluate(() => {
      const cs = [...document.querySelectorAll('protvista-uniprot canvas')];
      return cs.length > 0 && cs.every((c) => c.width > 0 && c.height > 0);
    })
  );
}

/**
 * Assert the picture contains exactly the rows the manifest claims.
 *
 * Set equality, not a count: a different set means the fixtures or the
 * rendering changed, and the figure no longer matches the prose beside it. Run
 * this *after* any interactions, since those can legitimately change the set.
 */
export async function assertGroups(page, prefix, expectGroups) {
  const got = (
    await page.evaluate(
      (p) =>
        [...document.querySelectorAll(`div[id^="${p}-group_"]`)]
          .filter((g) => getComputedStyle(g).display !== 'none')
          .map((g) => g.id.slice(`${p}-group_`.length)),
      prefix
    )
  ).sort();
  const want = [...expectGroups].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    const missing = want.filter((g) => !got.includes(g));
    const extra = got.filter((g) => !want.includes(g));
    throw new Error(
      `revealed rows differ from the manifest.\n` +
        (missing.length ? `  missing: ${JSON.stringify(missing)}\n` : '') +
        (extra.length ? `  unexpected: ${JSON.stringify(extra)}\n` : '') +
        `  expected ${want.length}, got ${got.length}`
    );
  }
}

/**
 * Assertions that must hold at capture time. Each corresponds to a way the
 * viewer can look plausible while being wrong.
 */
export async function assertCapturable(
  page,
  ledger,
  consoleProblems,
  { structure = false, structureId } = {}
) {
  if (ledger.unpinned.size) {
    throw new Error(
      `unpinned network request(s) — see the summary at the end of the run:\n` +
        [...ledger.unpinned].map((u) => `  ${u}`).join('\n')
    );
  }
  if (consoleProblems.length) {
    throw new Error(
      `page reported problems:\n` +
        consoleProblems.map((p) => `  ${p}`).join('\n')
    );
  }

  // The 3D pane resolves on its own clock, three fetches deep, and no earlier
  // gate waits for it: `waitForViewer` settles on the track rows, and the first
  // sized canvas it sees is a track's. Wait for the element before asking which
  // structure it shows, so a pane that is merely late reads as late rather than
  // as the wrong molecule.
  if (structureId) {
    // The label carries the pinned id: when the gate does time out, the entry
    // the pane was asked for is the first thing worth knowing — an id no row
    // matches leaves the pane mounted but empty, and nothing else would say so.
    await until(page, `3D pane mounted (pinned ${structureId})`, () =>
      page.evaluate(() => !!document.querySelector('nightingale-structure'))
    );
  }

  const bad = await page.evaluate(({ allowStructure, wantStructure }) => {
    const el = document.querySelector('protvista-uniprot');
    const issues = [];
    if (!el) issues.push('no <protvista-uniprot> on the page');
    else if (el.childElementCount === 0)
      issues.push('viewer rendered empty (no sequence or no config)');
    const alert = el?.querySelector('[role="alert"]');
    if (alert)
      issues.push(`error panel: ${alert.textContent.trim().slice(0, 160)}`);
    // The structure pane's own empty state is expected (we stub it away); any
    // other no-results means the viewer itself found nothing to draw.
    for (const n of document.querySelectorAll('.protvista-no-results')) {
      if (!n.closest('protvista-uniprot-structure')) {
        issues.push(`empty state: ${n.textContent.trim().slice(0, 120)}`);
      }
    }
    // If this ever appears, Mol*/WebGL mounted and the capture is no longer
    // reproducible. See the STRUCTURE_STUBS note in router.mjs.
    if (!allowStructure && document.querySelector('nightingale-structure')) {
      issues.push('<nightingale-structure> mounted — capture is non-deterministic');
    }
    // A shot that pins its structure must have got that structure. Without
    // this the pin failing is invisible: the pane simply falls back to
    // whichever entry it sorts first and photographs a different molecule
    // under a caption that names this one.
    if (wantStructure) {
      const shown = document
        .querySelector('nightingale-structure')
        ?.getAttribute('structure-id');
      if (shown !== wantStructure) {
        issues.push(
          `3D pane shows ${shown ?? 'no structure'}, not the pinned ${wantStructure}`
        );
      }
    }
    if (location.search.includes('layout=')) {
      issues.push('a persisted ?layout= leaked into the URL');
    }
    return issues;
  }, { allowStructure: structure, wantStructure: structureId });

  if (bad.length) {
    throw new Error(`viewer is not capturable:\n${bad.map((b) => `  ${b}`).join('\n')}`);
  }
}

/**
 * The clip rectangle. Defaults to the viewer element, stopping before the 3D
 * structure pane, which is excluded unless the shot opts in — see router.mjs.
 * A shot that wants the pane sets `clip.stopBefore: null` to lift the cut.
 */
export async function clipRect(page, shot) {
  if (shot.clip?.rect) return shot.clip.rect;
  const rect = await page.evaluate(
    ({ element, stopBefore }) => {
      const el = document.querySelector(element);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      let height = b.height;
      if (stopBefore) {
        const stop = document.querySelector(stopBefore);
        if (stop) height = stop.getBoundingClientRect().top - b.top;
      }
      return {
        x: Math.round(b.left + scrollX),
        y: Math.round(b.top + scrollY),
        width: Math.round(b.width),
        height: Math.round(height),
      };
    },
    {
      element: shot.clip?.element ?? 'protvista-uniprot',
      // An explicit `stopBefore: null` means "do not cut" — `??` would treat
      // that the same as omitting the key and reinstate the default.
      stopBefore:
        shot.clip && 'stopBefore' in shot.clip
          ? shot.clip.stopBefore
          : 'protvista-uniprot-structure',
    }
  );
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    throw new Error(`clip rect is empty for ${shot.id}: ${JSON.stringify(rect)}`);
  }

  // A fixed aspect ratio, taken from the top of the element. Starlight renders
  // the splash hero through `<Image width={400} height={400}>` with sharp's
  // default `cover` fit, so a non-square source is centre-cropped — capturing
  // square in the first place is what keeps the hero uncropped.
  if (shot.clip?.aspect) {
    rect.height = Math.round(rect.width / shot.clip.aspect);
  }

  // Playwright's own message for an out-of-bounds clip ("Clipped area is either
  // empty or outside the resulting image") does not say what was asked for.
  // Below roughly 900px the playground stacks its panes and the viewer moves
  // thousands of pixels down the page, which is exactly how a shot lands here.
  const view = page.viewportSize();
  if (rect.y + rect.height > view.height || rect.x + rect.width > view.width) {
    throw new Error(
      `clip ${JSON.stringify(rect)} falls outside the ${view.width}x${view.height} viewport. ` +
        `Widen the shot's viewport, or check the page has not switched to a stacked layout.`
    );
  }
  return rect;
}

/**
 * Screenshot the same region repeatedly until two consecutive buffers are
 * identical. This is the only honest answer to "has it stopped painting?" —
 * bounded, so a never-settling page fails instead of hanging.
 */
export async function captureStable(page, clip, { maxTries = 20 } = {}) {
  let previous = null;
  for (let i = 0; i < maxTries; i++) {
    const buf = await page.screenshot({ clip, animations: 'disabled' });
    if (previous && buf.equals(previous)) return buf;
    previous = buf;
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r()))
    );
  }
  throw new Error(
    `pixels never settled after ${maxTries} attempts — something on the page keeps redrawing`
  );
}
