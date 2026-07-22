import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import envCompatible from 'vite-plugin-env-compatible';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import svg from 'vite-plugin-svgo';

const entry = (file) => fileURLToPath(new URL(file, import.meta.url));

// Sample data for the bring-your-own-file playground presets (csv/json).
// The presets reference `./sample-data/hotspots.*` (resolved page-relative
// next to playground.html). Rather than commit a copy, this plugin serves
// and emits the *canonical* files straight from `examples/`, so those data
// files have a single source of truth and cannot drift.
const SAMPLE_DATA = [
  ['sample-data/hotspots.csv', 'examples/csv/hotspots.csv', 'text/csv'],
  ['sample-data/hotspots.json', 'examples/json/hotspots.json', 'application/json'],
];

function playgroundSampleData() {
  return {
    name: 'playground-sample-data',
    // Build: emit each example file into the bundle at `sample-data/*`.
    generateBundle() {
      for (const [fileName, source] of SAMPLE_DATA) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(entry(source), 'utf8') });
      }
    },
    // Dev: serve `/sample-data/*` directly from `examples/`.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const match = SAMPLE_DATA.find(([fileName]) => path === `/${fileName}`);
        if (!match) return next();
        res.setHeader('Content-Type', match[2]);
        res.end(readFileSync(entry(match[1]), 'utf8'));
      });
    },
  };
}

// Multi-page GitHub Pages site (hub + playground + demo + bench).
//
// Unlike vite.config.mjs (the single-entry *library* build), this config
// serves/builds several root HTML pages. Two deliberate differences make
// the multi-page site work in `vite`'s dev server, not just the build:
//   - `vite-plugin-html`'s `createHtmlPlugin` is NOT used. In its
//     single-page mode it is built around one `index.html` and makes the
//     dev server fall back to it for every other page; the pages carry
//     literal <title>s, so nothing needs injecting anyway.
//   - `base` is relative only for the built site (served from a project
//     Pages subpath). The dev server needs an absolute base to resolve
//     `/playground.html`, `/demo.html`, … as their own pages.
export default defineConfig(({ command }) => ({
  plugins: [viteCommonjs(), envCompatible(), svg(), playgroundSampleData()],
  base: command === 'build' ? './' : '/',
  build: {
    target: 'ES2021',
    outDir: 'demo',
    rollupOptions: {
      // Multi-page Pages site published from `demo/`:
      //   index.html      → landing hub
      //   playground.html → interactive config playground (#210)
      //   demo.html       → the human-facing accession demo (?accession=)
      //   bench.html      → minimal Lighthouse harness (bench/lighthouserc.cjs)
      input: {
        main: entry('index.html'),
        playground: entry('playground.html'),
        demo: entry('demo.html'),
        bench: entry('bench.html'),
      },
    },
  },
}));
