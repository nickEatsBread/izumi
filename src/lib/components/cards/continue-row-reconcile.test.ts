import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const row = readFileSync(fileURLToPath(new URL('./ContinueRow.svelte', import.meta.url)), 'utf8')
const cw = readFileSync(fileURLToPath(new URL('../../player/continue-watching.ts', import.meta.url)), 'utf8')

describe('Continue Watching reconcile trigger', () => {
  it('reconciles again when a tracker identity arrives after mount', () => {
    // A device transfer applies the AniList/MAL token while Home is already up. A mount-only
    // trigger had already returned early (no tracker) and never ran again until a restart.
    expect(row).not.toMatch(/onMount\(\(\) => \{ void reconcileContinueWatching/)
    expect(row).toMatch(/\$effect\(\(\) => \{\s*void reconcileContinueWatching\(client, userName, malActive\)\s*\}\)/)
  })

  it('leaves the no-tracker early return without arming the TTL, so the first real run is not throttled', () => {
    const fn = cw.slice(cw.indexOf('export async function reconcileContinueWatching'))
    const guard = fn.slice(0, fn.indexOf('const run ='))
    expect(guard).toContain('if (!userName && !malActive) { reconciledOnce.set(true); return }')
    expect(guard).not.toContain('lastReconciledAt = Date.now()')
  })
})
