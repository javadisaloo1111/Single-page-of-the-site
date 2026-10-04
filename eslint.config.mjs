/**
 * ESLint flat config.
 * The project runs in three very different environments, so globals are declared per group
 * instead of globally silencing rules. `no-undef` is the important one here: it catches the
 * typo/mis-import class of bug that would otherwise only appear at runtime in the browser.
 */
import js from '@eslint/js';

const BROWSER_GLOBALS = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  crypto: 'readonly', fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', queueMicrotask: 'readonly',
  console: 'readonly', performance: 'readonly', URL: 'readonly', Blob: 'readonly',
  FormData: 'readonly', AbortController: 'readonly', InputEvent: 'readonly', Event: 'readonly',
  CustomEvent: 'readonly', AudioContext: 'readonly', MediaRecorder: 'readonly',
  HTMLInputElement: 'readonly', HTMLTextAreaElement: 'readonly', MediaStream: 'readonly',
  requestAnimationFrame: 'readonly', matchMedia: 'readonly', getComputedStyle: 'readonly',
  self: 'readonly', globalThis: 'readonly', chrome: 'readonly', ResizeObserver: 'readonly',
  SpeechRecognition: 'readonly', webkitSpeechRecognition: 'readonly', DOMException: 'readonly'
};

const NODE_GLOBALS = {
  console: 'readonly', process: 'readonly', Buffer: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  globalThis: 'readonly', URL: 'readonly', TextEncoder: 'readonly'
};

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...BROWSER_GLOBALS, ...NODE_GLOBALS }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      eqeqeq: ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn'
    }
  },
  {
    // content scripts are classic scripts (no modules) sharing the namespace object
    files: ['src/content/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: BROWSER_GLOBALS },
    rules: { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }] }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS } }
  }
];
