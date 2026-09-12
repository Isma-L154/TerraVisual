import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'web/public/**',
      'core/**',
      // Generated from the JSON Schema. Not ours to lint.
      '**/generated/**',
      // Wrangler's build scratch directory.
      '.wrangler/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // User-supplied text reaches the DOM throughout this application:
      // resource names, labels, diagnostic messages. React escapes by default
      // and this keeps the one escape hatch closed (security control 4).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message:
            'dangerouslySetInnerHTML is banned: user-derived content reaches the DOM here. Render as text.',
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  {
    // The deployment Worker runs in a service-worker-shaped global scope, so
    // it gets the web platform globals rather than Node's.
    files: ['deploy/**/*.ts'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.browser },
    },
  },

  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  {
    files: ['web/src/**/*.test.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
      },
    },
  },
);
