import path from 'node:path'
import { defineConfig } from 'vitest/config'


export default defineConfig({
  root: '.',
  resolve: {
    alias: {
      src: path.resolve(import.meta.dirname, './src'),
      // The real module only ships type declarations; tests use a tiny stub.
      obsidian: path.resolve(import.meta.dirname, './src/test-utils/obsidian.ts'),
    },
  },
  test: {
    include: [
      '**/src/**/*.test.ts',
      '**/tests/**/*.ts'
    ]
  }
})
