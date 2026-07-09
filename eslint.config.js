'use strict';

const js = require('@eslint/js');

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  global: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  FormData: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  CustomEvent: 'readonly',
  MutationObserver: 'readonly',
  Image: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  requestIdleCallback: 'readonly',
  Node: 'readonly',
  Element: 'readonly',
  confirm: 'readonly',
  alert: 'readonly',
};

const jestGlobals = {
  describe: 'readonly',
  test: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  jest: 'readonly',
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'release/**',
      'backups/**',
      'tmp/**',
      '.data/**',
      'assets/styles/tailwind.generated.css',
      'unity_templates/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      // このコードベースは制御文字を意図的に除去するサニタイズ用正規表現(\x00-\x1fレンジ)を多用するため無効化。
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
  {
    files: ['renderer/**/*.js', 'render.js', 'preload.js', 'log_preload.js'],
    languageOptions: {
      globals: { ...browserGlobals, require: 'readonly' },
    },
  },
  {
    files: ['__tests__/**/*.js'],
    languageOptions: {
      globals: { ...nodeGlobals, ...jestGlobals },
    },
    rules: {
      'no-empty': 'off',
    },
  },
  {
    // render.js はフォールバック関数を宣言し、モジュール読み込み成功後に実体へ差し替える設計のため対象外。
    files: ['render.js'],
    rules: {
      'no-func-assign': 'off',
    },
  },
];
