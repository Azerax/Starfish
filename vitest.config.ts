import { defineConfig } from 'vitest/config'
export default defineConfig({
  // .tsx too: the @starfish/ui panel and theme tests are .tsx and were silently never collected.
  test: { include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'] }
})
