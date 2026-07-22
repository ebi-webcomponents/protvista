import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import envCompatible from 'vite-plugin-env-compatible';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import svg from 'vite-plugin-svgo';

const entry = (file) => fileURLToPath(new URL(file, import.meta.url));

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
  plugins: [viteCommonjs(), envCompatible(), svg()],
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
