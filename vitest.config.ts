import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The plugin listens for `visibilitychange` and reads `document.hidden`, so the suite
    // needs a DOM. The one file that pins the no-DOM (SSR) behaviour opts back out with a
    // per-file `@vitest-environment node` pragma.
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
    },
  },
})
