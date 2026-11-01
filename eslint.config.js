import stylistic from '@stylistic/eslint-plugin'
import obsidianmd from 'eslint-plugin-obsidianmd'

/**
 * The rules Obsidian applies when reviewing a community plugin.
 *
 * `obsidianmd.configs.recommended` is the review's own configuration: the
 * `obsidianmd/*` rules, `eslint-comments/*`, and typescript-eslint's
 * `recommendedTypeChecked` for type-aware checks. Running it here means a
 * commit sees the same findings as the review form, instead of rediscovering
 * them a week later.
 */
export default [
  {
    ignores: ['main.js', 'test-vault/**']
  },
  ...obsidianmd.configs.recommended,
  {
    // The review harness supplies these itself; type-aware rules need them.
    files: ['**/*.{ts,mts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    // Project style, which the review does not care about.
    files: ['**/*.ts', '*.js'],
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
    // Build and test-runner scripts, which are Node programs rather than
    // plugin code: `node:fs` is the point of them, and the vault path they
    // touch belongs to this repository, not to the user's vault.
    files: ['webpack.config.mts', 'vitest.config.ts'],
    rules: {
      'obsidianmd/no-nodejs-modules': 'off',
      'obsidianmd/hardcoded-config-path': 'off',
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
      'obsidianmd/ui/sentence-case': 'off',
      'obsidianmd/no-tfile-tfolder-cast': 'off',
      'obsidianmd/no-nodejs-modules': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // `closest()` and `querySelector()` infer their element type from the
      // assertion, so the rule calls an assertion that carries the type
      // "unnecessary" while removing it changes the type to `Element`.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      'no-var': 'off',
      'no-unused-expressions': 'off',
    },
  },
  {
    // `.d.ts` files describe an environment, so `no-undef` (which cannot see
    // ambient declarations) reports every type they declare.
    files: ['**/*.d.ts'],
    rules: {
      'no-undef': 'off',
    },
  },
]
