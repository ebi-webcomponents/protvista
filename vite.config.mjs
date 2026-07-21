import { defineConfig } from 'vite';
import envCompatible from 'vite-plugin-env-compatible';
import { createHtmlPlugin } from 'vite-plugin-html';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import svg from 'vite-plugin-svgo';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    viteCommonjs(),
    envCompatible(),
    createHtmlPlugin({
      inject: {
        data: {
          title: 'protvista-uniprot',
        },
      },
    }),
    svg(),
    dts({
      outDir: 'dist/types',
      insertTypesEntry: true,
    }),
  ],
  build: {
    target: 'ES2021',
    sourcemap: true,
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
    exclude: ['**/node_modules/**', '**/dist/**', '**/__mocks__/**'],
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
      ],
      // Coverage ratchet (#162): a fixed floor, seeded ~1% below the
      // measured baseline. CI runs `yarn test:coverage`, so a PR that
      // drops coverage below these numbers fails. This is a manual
      // ratchet — bump these up as coverage improves; never lower them
      // without a justification in the PR.
      thresholds: {
        statements: 70,
        branches: 69,
        functions: 67,
        lines: 70,
      },
    },
  },
});
