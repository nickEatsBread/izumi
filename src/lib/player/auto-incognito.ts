import { get } from 'svelte/store'
import { playing } from './session'
import { autoIncognitoAdult } from '$lib/settings/ui'
import { incognito, enterIncognito, exitIncognito } from '$lib/stores/incognito'
import type { Media } from '$lib/anilist/types'

// Auto-incognito for adult titles: playing an isAdult show flips incognito on for the duration of
// playback, then exits (purging the session overlay) when the player closes. If incognito was
// already on when playback started, the user chose it — the latch stays theirs and nothing
// auto-exits. A manual "Turn off" mid-playback also clears the latch (the subscription below sees
// the store go false), so closing the player won't exit a mode the user already left and re-armed.

let autoEntered = false

/** Call at playback start. Enters incognito only for adult media with the setting on. */
export function maybeAutoEnterIncognito(media: Media | undefined): void {
  if (!media?.isAdult || !get(autoIncognitoAdult) || get(incognito)) return
  autoEntered = true
  enterIncognito()
}

let started = false
/** Wire the exit trigger once, at boot: leaving playback ends an auto-entered incognito session. */
export function initAutoIncognito(): void {
  if (started) return
  started = true
  playing.subscribe((p) => {
    if (!p && autoEntered) {
      autoEntered = false
      exitIncognito()
    }
  })
  // Manual exit (banner/sidebar/settings) while auto-entered: hand the mode back to the user.
  incognito.subscribe((on) => {
    if (!on) autoEntered = false
  })
}
