import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('adaptive player skip metadata', () => {
  it('loads shared segment metadata once a duration is available', () => {
    const source = readFileSync(
      new URL('../components/player/PlayerOverlay.svelte', import.meta.url),
      'utf8',
    )
    const update = source.slice(
      source.indexOf('function onDrmUpdate'),
      source.indexOf('$effect(() =>', source.indexOf('function onDrmUpdate')),
    )

    expect(update).toContain('if (!metaLoaded && snapshot.dur > 0) void loadMeta()')
  })
})
