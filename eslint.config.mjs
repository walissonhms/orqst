import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      'apps/tauri/src-tauri/target/**',
      'apps/tauri/src-tauri/gen/**',
      '**/node_modules/**',
      '.overclock-app/**',
      '.codex/**',
      '.opencode/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
