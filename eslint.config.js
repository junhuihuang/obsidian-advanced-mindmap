import stylistic from '@stylistic/eslint-plugin'
import parserTs from '@typescript-eslint/parser'
import obsidianmd from 'eslint-plugin-obsidianmd'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: ['main.js', 'test-vault/**']
  },
  {
    files: ['**/*.ts', '*.js'],
    languageOptions: {
      parser: parserTs,
    },
    plugins: {
      '@stylistic': stylistic
    },
    rules: {
      '@stylistic/semi': ['error', 'never'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/arrow-parens': ['error', 'as-needed'],
      '@stylistic/linebreak-style': 'error',
      '@stylistic/eol-last': 'error'
    }
  },
  {
    // The rules Obsidian applies when reviewing a community plugin.
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      obsidianmd,
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'obsidianmd/no-static-styles-assignment': 'error',
      'obsidianmd/no-forbidden-elements': 'error',
      'obsidianmd/prefer-instanceof': 'warn',
      'obsidianmd/prefer-create-el': 'warn',
      'obsidianmd/prefer-window-timers': 'warn',
      'obsidianmd/no-global-this': 'warn',
      'obsidianmd/settings-tab/prefer-setting-definitions': 'warn',
      'no-useless-escape': 'warn',
      'no-var': 'warn',
      'no-unused-expressions': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-wrapper-object-types': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
    },
  },
  {
    // Test fixtures size fake nodes with inline styles and build DOM by hand;
    // none of the app-facing rules apply there.
    files: ['**/*.test.ts'],
    rules: {
      'obsidianmd/no-static-styles-assignment': 'off',
      'obsidianmd/prefer-create-el': 'off',
      'obsidianmd/prefer-window-timers': 'off',
      'obsidianmd/prefer-instanceof': 'off',
      'obsidianmd/no-global-this': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-var': 'off',
      'no-unused-expressions': 'off',
    },
  },
]
