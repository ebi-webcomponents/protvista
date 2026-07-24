import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import envCompatible from 'vite-plugin-env-compatible';
import { createHtmlPlugin } from 'vite-plugin-html';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import svg from 'vite-plugin-svgo';
import dts from 'vite-plugin-dts';
import { playwright } from '@vitest/browser-playwright';

// Vitest sets this when it evaluates the config. `vite-plugin-html`
// intercepts *every* HTML request — including the tester page Vitest
// browser mode serves — and mangles the orchestrator script so the
// browser session never connects. `dts` is build-only. Both are dead
// weight (or actively harmful) under test, so drop them there.
const isVitest = !!process.env.VITEST;

export default defineConfig({
  plugins: [
    viteCommonjs(),
    envCompatible(),
    svg(),
    ...(isVitest
      ? []
      : [
          createHtmlPlugin({
            inject: {
              data: {
                title: 'protvista-uniprot',
              },
            },
          }),
          dts({
            outDir: 'dist/types',
            insertTypesEntry: true,
          }),
        ]),
  ],
  resolve: {
    alias: {
      // axe-core's UMD bundle statically imports the optional `vertx`
      // async scheduler (guarded by a try/catch at runtime). It isn't
      // installed, so Vite's import analysis fails to resolve it — point
      // it at an empty stub. Harmless for the lib build (the app never
      // touches `vertx`).
      vertx: fileURLToPath(new URL('./src/__browser__/vertx-stub.js', import.meta.url)),
    },
  },
  build: {
    target: 'ES2021',
    sourcemap: true,
    // The lib build must not copy `public/` (the hosted JSON Schema) into
    // `dist/`: the schema is served from GitHub Pages, its authored source
    // already ships via the `src` entry in package.json `files`, and a
    // `dist/schema/...` path would not match the schema's `$id`. The demo
    // build (vite.demo.config.mjs) still copies it into `demo/` for Pages.
    copyPublicDir: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'protvista-uniprot.mjs',
    },
    rollupOptions: {
      output: {
        chunkFileNames: '[name].js',
      },
    },
  },
  test: {
    // Two projects share this one Vite config (plugins, resolve, etc.):
    //  - `unit`    — the historical jsdom suite (fast, no browser).
    //  - `browser` — real-DOM accessibility + interaction tests driven
    //                by Playwright/Chromium with axe-core assertions.
    // `coverage` stays at this root level: it is a runner-wide option
    // (not per-project) and spans both projects when `--coverage` runs.
    projects: [
      {
        // Inherit this file's plugins/resolve; only override `test`.
        extends: true,
        test: {
          name: 'unit',
          globals: false,
          environment: 'jsdom',
          // `setup.ts` filters jsdom's benign CSS-parse warnings (jsdom's
          // cssom is CSS2-era and chokes on modern syntax).
          // `nightingale-mocks.ts` stubs every `@nightingale-elements/*`
          // module to a trivial `HTMLElement` subclass so specs that mount
          // `<protvista-uniprot>` don't execute d3/Mol*/SVG layout work.
          setupFiles: [
            'src/__spec__/setup.ts',
            'src/__spec__/nightingale-mocks.ts',
          ],
          include: [
            'src/**/__spec__/*.spec.ts',
            'src/**/__tests__/*.spec.ts',
            'src/**/*.spec.ts',
          ],
          // The browser specs live under `src/**/__browser__/` and must
          // never load under jsdom (they use `@vitest/browser/context`).
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/__mocks__/**',
            '**/__browser__/**',
            '**/*.browser.spec.ts',
          ],
        },
      },
      {
        extends: true,
        // Pre-bundle the element's transitive deps up front. Without this
        // Vite discovers them lazily and re-optimizes mid-run, which drops
        // the Playwright browser session ("Vite unexpectedly reloaded a
        // test"). They are all `vi.mock`ed at runtime, so pre-bundling only
        // costs a one-time optimize, not real d3/Mol* execution.
        optimizeDeps: {
          include: [
            '@nightingale-elements/nightingale-colored-sequence',
            '@nightingale-elements/nightingale-filter',
            '@nightingale-elements/nightingale-linegraph-track',
            '@nightingale-elements/nightingale-manager',
            '@nightingale-elements/nightingale-navigation',
            '@nightingale-elements/nightingale-sequence',
            '@nightingale-elements/nightingale-sequence-heatmap',
            '@nightingale-elements/nightingale-structure',
            '@nightingale-elements/nightingale-track-canvas',
            '@nightingale-elements/nightingale-variation-canvas',
            '@floating-ui/dom',
            '@markdoc/markdoc',
            'ajv/dist/2020',
            'color-hash',
            'js-yaml',
            'lit/directives/unsafe-html.js',
            'timing-functions',
          ],
        },
        test: {
          name: 'browser',
          globals: false,
          include: ['src/**/__browser__/*.browser.spec.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          // Reuses the Nightingale stubs so `<protvista-uniprot>` mounts
          // without pulling d3/Mol* into the browser bundle.
          setupFiles: ['src/__browser__/setup.ts'],
          browser: {
            enabled: true,
            // Vitest 4 takes a provider factory (not the legacy string).
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // Count all src files in the denominator, not just files imported
      // by tests. Without this, vitest 4 only reports on files tests
      // actually reach, which inflates the % drastically.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/__spec__/**',
        'src/**/__tests__/**',
        'src/**/__mocks__/**',
        'src/**/__browser__/**',
        'src/index.ts',
        // Type-only files — no runtime to cover.
        'src/**/*.d.ts',
        'src/types/**',
        'src/adapters/types/**',
        // Static lookup tables / config constants — no branches or funcs
        // to cover, and including them inflates aggregate %.
        'src/adapters/config/**',
        // Style template strings.
        'src/styles/**',
        // Playground DOM / CodeMirror wiring — integration-level, not
        // unit-tested. The unit-testable logic is factored into the
        // sibling modules (format, url-state, presets, lint,
        // diagnostics-view), which ARE covered by __spec__.
        'src/playground/index.ts',
        'src/playground/editor.ts',
        'src/playground/splitter.ts',
      ],
      // Coverage ratchet (#162): a fixed floor, seeded ~1% below the
      // measured baseline. CI runs `yarn test:coverage`, so a PR that
      // drops coverage below these numbers fails. This is a manual
      // ratchet — bump these up as coverage improves; never lower them
      // without a justification in the PR.
      thresholds: {
        statements: 80,
        branches: 74,
        functions: 78,
        lines: 81,
      },
    },
  },
});
