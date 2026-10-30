// Flat config used only by the complexity measurement (measure.mjs in this
// directory). It runs ESLint's core `complexity` rule (cyclomatic complexity,
// classic variant) with `max: 0`, so every function is reported with its
// score. Inline `eslint-disable` comments are ignored so they cannot hide a
// function. It also works from the CLI:
//   pnpm exec eslint --no-config-lookup \
//     -c scripts/complexity/eslint.complexity.config.mjs -f json src
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'off',
    },
    rules: { complexity: ['warn', { max: 0, variant: 'classic' }] },
  },
];
