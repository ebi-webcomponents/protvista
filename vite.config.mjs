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
      // Ratchet pattern: thresholds are seeded at the current baseline so
      // coverage can only go up. Initial values below are placeholders —
      // run `yarn test:coverage` once on `next`, read the four numbers off
      // the summary table, and update these to ~1–2% below the observed
      // baseline. Until then CI will not fail on coverage drop. See the
      // "Hooks and feedback loop" section in CONTRIBUTING.md.
      thresholds: {
        lines: 11.13,
        functions: 14.08,
        branches: 7.54,
        statements: 12.01,
      },
    },
  },
});
