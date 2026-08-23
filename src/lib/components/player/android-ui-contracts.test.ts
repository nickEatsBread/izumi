import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (url: URL) => readFileSync(fileURLToPath(url), 'utf8')
const player = read(new URL('./AndroidPlayer.svelte', import.meta.url))
const connecting = read(new URL('./SourceConnecting.svelte', import.meta.url))
const detail = read(new URL('../detail/AnimeDetail.svelte', import.meta.url))
const layout = read(new URL('../../../routes/app/+layout.svelte', import.meta.url))

describe('Android UI contracts', () => {
  it('uses the native share sheet for a series', () => {
    expect(detail).toContain("invoke('plugin:extplayer|share_text'")
    expect(detail).toContain('aria-label="Share series"')
  })

  it('uses a bottom-edge loader instead of the full connecting screen on Android', () => {
    expect(connecting).toContain('{#if $isAndroid}')
    expect(connecting).toContain('class="bar-loader h-1.5 w-full"')
    expect(connecting).toContain('top: calc(env(safe-area-inset-top) + 56.25vw')
  })

  it('collapses portrait playback to Home and reveals browse behind the mini-player', () => {
    expect(player).toContain("await goto('/app/home')")
    expect(player).toContain('androidMiniPlayer.set(true)')
    expect(player).toContain("gesture = 'minimize'")
    expect(layout).toContain('$androidMpvActive && !$androidMiniPlayer')
  })
})
