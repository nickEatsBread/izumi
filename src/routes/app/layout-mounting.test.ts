import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The app layout lazy-mounts the heavy player/overlay components so they stay off the boot chunk.
// That optimization is only safe for components which are PURELY driven by the store they are
// gated on. A component whose own `onMount` registers the listener that CAUSES the store to be
// set must stay eagerly mounted, or the gate becomes circular and the feature silently dies.

const layout = readFileSync(fileURLToPath(new URL('./+layout.svelte', import.meta.url)), 'utf8')
const deckWarning = readFileSync(
  fileURLToPath(new URL('../../lib/components/shell/DeckKeyboardWarning.svelte', import.meta.url)),
  'utf8',
)

describe('app layout mounting', () => {
  it('mounts DeckKeyboardWarning eagerly, never behind its own store', () => {
    // Regression: gating this on `$deckKeyboardWarning` meant the `deck-keyboard-warning` listener
    // never registered, so the native side's login popup — which stays HIDDEN until JS answers via
    // resolve_deck_login_popup — never became visible. Sign-in on the Deck just did nothing.
    expect(layout).toContain('<DeckKeyboardWarning />')
    expect(layout).not.toMatch(/\{#if \$deckKeyboardWarning\}[^\n]*Lazy/)
  })

  it('still has the listener that makes eager mounting necessary', () => {
    // If this listener ever moves out of the component (e.g. into a store module), the eager mount
    // above can be reconsidered — until then the two facts belong together.
    expect(deckWarning).toContain('onMount')
    expect(deckWarning).toContain("'deck-keyboard-warning'")
  })

  it('keeps the heavy player surfaces lazy', () => {
    for (const loader of ['loadPlayerOverlay', 'loadAndroidPlayer', 'loadStreamPicker']) {
      expect(layout).toContain(`Lazy load={${loader}}`)
    }
  })

  it('prepares the Android mpv core only inside deferred player boot work', () => {
    const playerBoot = layout.slice(
      layout.indexOf("scheduleBootWork('player'"),
      layout.indexOf("}, 2500)") + "}, 2500)".length,
    )
    expect(playerBoot).toContain('prepareEmbeddedPlayer()')
    expect(playerBoot).toContain('if (get(isAndroid))')
  })

  it('never mounts the AniList degraded banner over active playback', () => {
    expect(layout).toContain('{#if !$playing}<AniListDegradedBanner />{/if}')
  })
})
