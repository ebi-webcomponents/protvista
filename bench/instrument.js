/**
 * External instrumentation for protvista-uniprot.
 *
 * Always loaded by the demo build, but no-ops unless the URL has
 * `?bench=1`. Emits `performance.mark` / `performance.measure` calls
 * based on the component's existing public surface — no `src/` changes.
 *
 * Lighthouse's user-timings audit picks these up automatically, so they
 * show up in `summary.md` next to LCP/TBT/etc.
 *
 * Marks:
 *   protvista:script-start    when this script runs (≈ navigation start)
 *   protvista:data-loaded     loader removed (data fetched + parsed)
 *   protvista:first-render    nightingale-manager appears under the host
 *   protvista:tracks-settled  no host-subtree mutations for QUIESCENCE_MS
 *                             (proxy for "tracks finished painting")
 *
 * Measures:
 *   protvista:fetch-and-parse  script-start → data-loaded
 *   protvista:render           data-loaded → tracks-settled (incl. quiescence gap)
 *   protvista:total            script-start → tracks-settled
 *
 * The render measure ends at tracks-settled rather than first-render
 * because Lit batches the loader-removal and manager-insertion into the
 * same render cycle — first-render fires before nightingale's track
 * elements have actually painted. Quiescence detection is the same
 * pattern Playwright's `networkidle` and web-vitals' "long task" probes
 * use; the QUIESCENCE_MS threshold below is a constant offset that
 * cancels out in before/after comparisons.
 *
 * If the public events change shape, marks may go missing — fail loudly
 * by checking summary.md, not silently by adding fallback heuristics.
 */

if (new URLSearchParams(location.search).has('bench')) {
  run();
}

function run() {
  const HOST_TAG = 'protvista-uniprot';
  const RENDERED_CHILD = 'nightingale-manager';
  const LOADER_CLASS = 'protvista-loader';
  const QUIESCENCE_MS = 250;

  performance.mark('protvista:script-start');

  const hasMark = (name) =>
    performance.getEntriesByName(name, 'mark').length > 0;

  function whenHostExists() {
    return new Promise((resolve) => {
      const found = document.querySelector(HOST_TAG);
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(HOST_TAG);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    });
  }

  whenHostExists().then((host) => {
    // We watch the light-DOM host for three transitions:
    //   1. `.protvista-loader` was shown and is now gone → data has loaded
    //   2. `<nightingale-manager>` is present            → component has first-rendered
    //   3. no further subtree mutations for QUIESCENCE_MS → tracks have settled
    //
    // The component's own `protvista-event{hasData}` is unreliable
    // (see "Note: this doesn't seem to work" in src/protvista-uniprot.ts);
    // the loader div is the next-best public signal of "fetch resolved".
    //
    // Why the `loaderEverSeen` flag matters: the host can be observed
    // *before* Lit's first render inserts the loader. A naive "loader not
    // present" check then fires `data-loaded` immediately at framework
    // startup time — wrong by orders of magnitude.
    let loaderEverSeen = !!host.querySelector(`.${LOADER_CLASS}`);
    let settleTimer = null;

    const obs = new MutationObserver(() => {
      const loaderPresent = !!host.querySelector(`.${LOADER_CLASS}`);
      const managerPresent = !!host.querySelector(RENDERED_CHILD);
      if (loaderPresent) loaderEverSeen = true;

      // Data loaded: loader was shown and is now gone. Fallback: manager
      // appeared without a loader ever showing (cached / instant render).
      if (
        !hasMark('protvista:data-loaded') &&
        ((loaderEverSeen && !loaderPresent) ||
          (managerPresent && !loaderEverSeen))
      ) {
        performance.mark('protvista:data-loaded');
        performance.measure(
          'protvista:fetch-and-parse',
          'protvista:script-start',
          'protvista:data-loaded'
        );
      }

      if (!hasMark('protvista:first-render') && managerPresent) {
        performance.mark('protvista:first-render');
      }

      // Once first-render has fired, debounce: every new mutation pushes
      // the settle timer out by QUIESCENCE_MS. When the timer finally
      // expires, the subtree has been mutation-free for that long and we
      // treat painting as done.
      if (hasMark('protvista:first-render')) {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(settle, QUIESCENCE_MS);
      }
    });

    function settle() {
      if (hasMark('protvista:tracks-settled')) return;
      if (!hasMark('protvista:first-render')) return;
      performance.mark('protvista:tracks-settled');
      if (hasMark('protvista:data-loaded')) {
        performance.measure(
          'protvista:render',
          'protvista:data-loaded',
          'protvista:tracks-settled'
        );
      }
      performance.measure(
        'protvista:total',
        'protvista:script-start',
        'protvista:tracks-settled'
      );
      obs.disconnect();
    }

    obs.observe(host, { childList: true, subtree: true });
  });
}
