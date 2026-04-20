import js from '@eslint/js';
import ts from 'typescript-eslint';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
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
        ...globals.jest,
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
];
