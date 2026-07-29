import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import envCompatible from 'vite-plugin-env-compatible';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import svg from 'vite-plugin-svgo';

const entry = (file) => fileURLToPath(new URL(file, import.meta.url));

// Builds the minimal Lighthouse harness (bench.html) into the site.
//
// The Astro + Starlight docs (including the native playground page) are the site
// — this build only adds `bench.html`, merged into the same `site/` directory
// with `emptyOutDir: false` so it does not wipe the docs (`site:build` runs the
// Astro docs build first, which owns `index.html` and empties `site/`). bench is
// kept a SEPARATE vite build (not an Astro page) so it stays bare and its
// Lighthouse baselines under `bench/baselines/` remain comparable — see
// `bench/lighthouserc.cjs`. Vite's default `copyPublicDir` also copies the
// repo-root `public/` (the published JSON Schema) into `site/`, so
// `/protvista/schema/…` resolves (Astro copies `docs/public/`, not this one).
export default defineConfig(({ command }) => ({
  plugins: [viteCommonjs(), envCompatible(), svg()],
  // Relative for the built page (served from a project Pages subpath); absolute
  // for the dev server so it resolves `/bench.html` as its own page.
  base: command === 'build' ? './' : '/',
  build: {
    target: 'ES2021',
    outDir: 'site',
    emptyOutDir: false,
    rollupOptions: {
      input: { bench: entry('bench.html') },
    },
  },
}));
