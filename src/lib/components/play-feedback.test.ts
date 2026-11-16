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
    for (const loader of ['loadStreamPicker', 'loadSourceConnecting']) {
      const mount = layout.match(new RegExp(`<Lazy load=\\{${loader}\\}>([\\s\\S]*?)</Lazy>`))
      expect(mount?.[1]).toContain('{#snippet pending()}')
      expect(mount?.[1]).toContain('<PlayFeedback')
    }
  })

  it('puts the connecting screen up with a Continue card press, before the playback import', () => {
    // A controller press on the Deck showed only the card's spinner for 1.25 s while it loaded.
    const card = readFileSync(fileURLToPath(new URL('./cards/ContinueCard.svelte', import.meta.url)), 'utf8')
    const play = card.slice(card.indexOf('async function play()'), card.indexOf('</script>'))
    expect(play.indexOf('connecting.set(pending)')).toBeGreaterThan(-1)
    expect(play.indexOf('connecting.set(pending)')).toBeLessThan(play.indexOf('await loadPlayback()'))
    // A cancel during the import stops it from starting playback, and a failed import clears only
    // this stand-in, never a screen a newer press put up.
    expect(play).toContain('if (cancelled) return')
    expect(play).toContain('connecting.update((c) => (c === pending ? null : c))')
  })

  it('stays silent for a binge continuation, which hides the picker deliberately', () => {
    expect(layout).toContain('{#if !$streamPicker?.hidden && !$streamPicker?.playbackError}')
  })

  it('stays cheap enough to be worth eager-bundling', () => {
    // The whole point is that this renders while the heavy chunk is still loading. An import here
    // could drag that chunk into the boot bundle and defeat it. The one exception is the shared
    // spinner, which only reads stores the app shell already imports.
    expect(feedback.match(/^[ \t]*import .*$/gm)).toEqual(["  import Spinner from './Spinner.svelte'"])
    expect(layout).toContain("from '$lib/player/session'")
    expect(layout).toContain("from '$lib/settings/ui'")
  })
})
