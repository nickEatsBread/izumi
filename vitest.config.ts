import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  // `scripts/` is included so CI tooling can be unit-tested too: the release version maths used to
  // live inline in a workflow, where the only way to find out it was wrong was a failed 25-minute
  // build.
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      '$env/static/public': fileURLToPath(new URL('./src/test/env-public-stub.ts', import.meta.url)),
      '$env/dynamic/public': fileURLToPath(new URL('./src/test/env-public-stub.ts', import.meta.url)),
    },
  },
})
