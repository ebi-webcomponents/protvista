import js from '@eslint/js';
import ts from 'typescript-eslint';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  ...ts.configs.recommended.map((c) => ({
    ...c,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  prettier,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },

    plugins: {
      '@typescript-eslint': tsPlugin,
      'no-unsanitized': noUnsanitized,
    },

    /* start with the plugin's own recommended rules... */
    rules: {
      ...tsPlugin.configs.recommended.rules,

      /* ...then apply your custom tweaks */
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',

      /* Security: flag unsafe DOM manipulation */
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    },
  },

  /* Bench runners and the screenshot harness — node scripts, not shipped. */
  {
    files: ['bench/**/*.{mjs,cjs}', 'scripts/**/*.{mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  /* The screenshot harness evaluates functions inside the page, where `window`
     globals are in scope rather than Node's. */
  {
    files: ['scripts/screenshots/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
];
