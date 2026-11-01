import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'test-results', 'playwright-report', '.claude', 'screenshots'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // engine = pure logic: no React, no screens, no app state
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['react', 'react-dom', 'zustand', 'lucide-react'], message: 'engine/ must stay UI-free.' },
        { group: ['@/features/*', '@/app/*', '@/session/*', '@/state/*', '@/ui/*', '@/sync/*', '@/data/*'], message: 'engine/ must not depend on app layers.' },
      ] }],
    },
  },
  {
    // data and sync are below the UI
    files: ['src/data/**/*.ts', 'src/sync/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['@/features/*', '@/app/*', '@/ui/*'], message: 'data/ and sync/ must not depend on screens.' },
      ] }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
)
