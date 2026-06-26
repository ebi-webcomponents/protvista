/**
 * Lighthouse CI config.
 *
 * `lhci autorun` will boot `vite preview` against the demo build, run
 * Lighthouse N times against each URL, then write reports under
 * bench/results/lighthouse/.
 *
 * Edit `collect.url` to change scenarios. Each query string is a UniProt
 * accession; index.html reads `?accession=` and renders that protein.
 */
module.exports = {
  ci: {
    collect: {
      // Built artefact lives in `demo/` (see vite.demo.config.mjs).
      // --strictPort makes startup fail loudly if 4173 is busy instead of
      // silently moving to another port that the URLs below won't match.
      startServerCommand:
        'npx vite preview --config vite.demo.config.mjs --port 4173 --strictPort',
      startServerReadyPattern: 'Local:',
      // The component emits `protvista:*` performance marks/measures
      // unconditionally; Lighthouse captures them via its user-timings
      // audit and `bench/summarize.mjs` surfaces them in summary.md.
      url: [
        // Well-annotated default — features, variants, structure.
        'http://localhost:4173/?accession=P05067',
        // Heavy entry — many variants, 3D Beacons.
        'http://localhost:4173/?accession=P38398',
        // Sparse entry — minimal feature load.
        'http://localhost:4173/?accession=A0A2K5ULD0',
      ],
      // 5 runs per URL — LHCI takes the median, this smooths out the
      // noise floor more than the default 3 without doubling wall time.
      numberOfRuns: 5,
      settings: {
        // Library demo, not a PWA — only the perf category is meaningful.
        onlyCategories: ['performance'],
        // Researchers use this on desktop; mobile throttling distorts the
        // signal we care about.
        preset: 'desktop',
        // Be explicit so two machines on different Chrome versions still
        // produce comparable numbers.
        chromeFlags: '--headless=new --no-sandbox',
        // Default is 45000 ms; the heavy variation payload on P38398
        // sometimes runs right at that edge and Lighthouse marks the
        // whole run as a page-load failure (Perf=0, all audits empty).
        // 60 s gives those scenarios room to finish.
        maxWaitForLoad: 60000,
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './bench/results/lighthouse',
      reportFilenamePattern: '%%PATHNAME%%-%%DATETIME%%-%%EXTENSION%%',
    },
  },
};
