/**
 * The route table. Every request a capture makes resolves here, and anything
 * not accounted for is aborted and reported — a screenshot must never depend on
 * a network that might be slow, down, or curated differently tomorrow.
 *
 * Order matters:
 *   1. Same-origin overrides — files the built site does not serve but a config
 *      asks for.
 *   2. Same-origin otherwise — the local preview server.
 *   3. Structure-pane stubs — see `STRUCTURE_STUBS`.
 *   4. Recorded fixtures.
 *   5. Anything else — abort, and record it in the ledger so the run fails with
 *      the exact URL rather than silently producing a different picture.
 */
import { readFileSync } from 'node:fs';
import { loadIndex, loadBody } from './fixtures.mjs';

/**
 * The 3D structure pane is deliberately kept out of every capture.
 *
 * `nostructure` defaults to false, so `<protvista-uniprot-structure>` always
 * mounts; left alone it loads Mol* (WebGL) and a multi-megabyte model, whose
 * canvas contents and camera settle are not reproducible and for which no
 * readiness signal exists.
 *
 * Serving `[]` for these two makes `processPDBData([])` return empty, so
 * `<nightingale-structure>` is never created — no WebGL, no model download, no
 * console noise. The structure-derived *tracks* (STRUCTURE_COVERAGE,
 * ALPHAFOLD_CONFIDENCE, ALPHAMISSENSE_PATHOGENICITY) are ordinary rows fed by
 * the AlphaFold fixture and are unaffected, so nothing the docs claim is lost.
 *
 * `ready.mjs` asserts `<nightingale-structure>` never appears, so if a future
 * release starts feeding the pane differently this fails loudly instead of
 * going flaky.
 */
const STRUCTURE_STUBS = [/rest\.uniprot\.org\/uniprotkb\//, /3dbeacons/];

export function createLedger() {
  return { unpinned: new Set(), served: new Set(), stubbed: new Set() };
}

export async function installRoutes(context, { baseURL, ledger }) {
  const index = loadIndex();

  await context.route('**/*', async (route) => {
    const url = route.request().url();

    // 1 + 2. Same-origin.
    if (url.startsWith(baseURL)) {
      const path = new URL(url).pathname;

      // `extends: /src/default-config.yaml` — the tutorial's layered config
      // points here, but the built site serves only `docs/`. Serve the repo's
      // real file rather than copying it into docs/public just to make a
      // screenshot work.
      if (path === '/src/default-config.yaml') {
        ledger.served.add(url);
        return route.fulfill({
          status: 200,
          contentType: 'text/yaml; charset=utf-8',
          body: readFileSync('src/default-config.yaml', 'utf8'),
        });
      }

      // `data: ./hotspots.csv` resolves against the *page*, not the config, so
      // a config loaded via `#config=` looks for it beside /playground/.
      if (path === '/protvista/playground/hotspots.csv') {
        ledger.served.add(url);
        return route.fulfill({
          status: 200,
          contentType: 'text/csv; charset=utf-8',
          body: readFileSync('examples/extend-default/hotspots.csv', 'utf8'),
        });
      }

      return route.continue();
    }

    // 3. Structure pane.
    if (STRUCTURE_STUBS.some((re) => re.test(url))) {
      ledger.stubbed.add(url);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    }

    // 4. Recorded fixture. Replays the recorded status verbatim, including the
    // 404 that `proteins/api/rna-editing` genuinely returns — reproducing the
    // real viewer means reproducing its failures too.
    const entry = index[url];
    if (entry) {
      ledger.served.add(url);
      return route.fulfill({
        status: entry.status,
        contentType: entry.contentType,
        body: loadBody(entry),
      });
    }

    // 5. Unaccounted for.
    ledger.unpinned.add(url);
    return route.abort();
  });
}

/** Which recorded statuses are expected, so a replayed 404 is not an error. */
export function expectedStatuses() {
  const index = loadIndex();
  return new Map(Object.entries(index).map(([url, e]) => [url, e.status]));
}
