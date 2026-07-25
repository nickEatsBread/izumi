import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  // `providers/` holds ported source extensions. They live OUTSIDE src/ on purpose — they are
  // standalone payloads served by URL, never bundled into the app — but they are still tested here.
  test: { environment: 'node', include: ['src/**/*.test.ts', 'providers/**/*.test.ts'] },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      '$env/static/public': fileURLToPath(new URL('./src/test/env-public-stub.ts', import.meta.url)),
    },
  },
})
