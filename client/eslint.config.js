import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Classic hooks rules — valid hook call order and complete dep arrays.
      'react-hooks/rules-of-hooks':  'error',
      'react-hooks/exhaustive-deps': 'warn',
      // React Compiler rules (new in react-hooks v7) fire on normal patterns
      // like setState inside useEffect. Disabled — this codebase does not use
      // the React Compiler.
      'react-hooks/react-compiler': 'off',

      // Catches the exact bug class we fixed: two keys with the same name
      // in an object literal (second silently wins).
      'no-dupe-keys': 'error',
      // Empty catch blocks are intentional in several places (SSE JSON parse,
      // localStorage in private-browsing mode). Allow them.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Keep the codebase free of debug statements.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Unused vars as warnings; underscored args are intentionally unused.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        EventSource: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        MutationObserver: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        ReadableStream: 'readonly',
        structuredClone: 'readonly',
        crypto: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        process: 'readonly',
        CustomEvent: 'readonly',
      },
    },
    files: ['src/**/*.{js,jsx}'],
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
