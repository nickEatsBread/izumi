import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Tapping an episode sometimes produced NO loading state at all: no skeleton, no spinner, nothing —
// and then the video, seconds later.
//
// The only pre-playback feedback is the stream picker's skeleton (a direct tap) or SourceConnecting
// (a resume), and both mount through Lazy. Lazy's `{#await mod then …}` had no pending branch, so
// from the click until the dynamic import resolved the DOM held nothing. That import graph carries
// a large player graph — so on a cold HTTP cache (a fresh install, the first play after an update)
// it was fetched from the network at the moment of the tap, racing the resolve
// it was supposed to be reporting on. When the resolve won, the loading state never appeared at all.

const lazy = readFileSync(fileURLToPath(new URL('./Lazy.svelte', import.meta.url)), 'utf8')
const feedback = readFileSync(fileURLToPath(new URL('./PlayFeedback.svelte', import.meta.url)), 'utf8')
const layout = readFileSync(fileURLToPath(new URL('../../routes/app/+layout.svelte', import.meta.url)), 'utf8')

describe('Lazy pending state', () => {
  it('renders something while the import is in flight', () => {
    expect(lazy).toContain('{#await mod}')
    expect(lazy).toContain('{@render pending?.()}')
  })

  it('keeps the pending snippet optional, so silent mounts stay silent', () => {
    // The Android player mounts lazily too, but mpv owns the screen there — a scrim would be wrong.
    expect(lazy).toContain('pending?: Snippet')
    expect(layout).toContain('{#if $androidMpvActive}<Lazy load={loadAndroidPlayer} />{/if}')
  })
})

describe('player-flow feedback', () => {
  it('covers both paths that are the user’s only feedback', () => {
    expect(layout).toContain('load={loadStreamPicker}')
    expect(layout).toContain('load={loadSourceConnecting}')
    const pendingSnippets = layout.match(/\{#snippet pending\(\)\}/g) ?? []
    expect(pendingSnippets.length).toBe(2)
  })

  it('stays silent for a binge continuation, which hides the picker deliberately', () => {
    expect(layout).toContain('{#if !$streamPicker?.hidden}')
  })

  it('stays cheap enough to be worth eager-bundling', () => {
    // The whole point is that this renders while the heavy chunk is still loading. An import here
    // could drag that chunk into the boot bundle and defeat it.
    expect(feedback).not.toMatch(/^\s*import /m)
    expect(feedback).not.toMatch(/from ['"]/)
  })
})
