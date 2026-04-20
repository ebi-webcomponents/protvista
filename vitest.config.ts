import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    // `jsdom` gives us customElements, HTMLElement, etc. — required for
    // any future test that instantiates a Lit component, and harmless
    // for the current set of pure-data tests.
    environment: 'jsdom',
    // Filter jsdom's "Could not parse CSS stylesheet" warnings.
    // See src/__spec__/setup.ts for the rationale.
    setupFiles: ['src/__spec__/setup.ts'],
    // Match the legacy jest file layout so existing tests keep working.
    //   src/__spec__/*.spec.ts
    //   src/**/__spec__/*.spec.ts
    //   src/**/__tests__/*.spec.ts
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
    },
  },
});
