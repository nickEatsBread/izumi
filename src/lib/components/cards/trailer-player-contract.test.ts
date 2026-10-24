import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETTINGS_SEARCH_INDEX } from '$lib/settings/search'

// Source contract for the full-window trailer player: this vitest config cannot mount Svelte components.
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const player = read('./TrailerPlayer.svelte')

describe('trailer player', () => {
  it('is reached only through openTrailerPopup, which picks popup or player', () => {
    expect(read('../../stores/trailer.ts')).toContain('trailerPopup.set({ id, title, mode })')
    expect(read('../detail/AnimeDetail.svelte')).toContain('openTrailerPopup(full.trailer.id, title(full))')
    expect(read('../catalog/CatalogMediaDetail.svelte')).toContain('openTrailerPopup(media.trailer.id, title(media))')
    expect(read('./YoutubeTrailer.svelte')).toContain('openTrailerPopup(id, title)')
    expect(read('./TrailerDialog.svelte')).toContain("const open = $derived($trailerPopup?.mode === 'popup' ? $trailerPopup : null)")
    expect(player).toContain("const trailer = $derived($trailerPopup?.mode === 'player' ? $trailerPopup : null)")
  })

  it('mounts lazily beside the trailer dialog, each on first use of its mode', () => {
    const layout = read('../../../routes/app/+layout.svelte')
    expect(layout).toContain("const loadTrailerPlayer = () => import('$lib/components/cards/TrailerPlayer.svelte')")
    expect(layout).toContain("if ($trailerPopup?.mode === 'player') trailerPlayerMounted = true")
    expect(layout).toContain('{#if trailerDialogMounted}<Lazy load={loadTrailerDialog} />{/if}\n{#if trailerPlayerMounted}<Lazy load={loadTrailerPlayer} />{/if}')
  })

  it('is a nav layer under the desktop titlebar, so B and remote Back close it', () => {
    expect(player).toContain("use:navLayer={{ kind: 'trailer-player', onClose: () => closeTrailerPopup(), initialFocus: 'none' }}")
    expect(player).toMatch(/data-slot="trailer\.player" data-nav-trap data-nav-escape role="dialog"/)
    expect(player).toContain('class="fixed inset-0 z-[45]')
    expect(player).not.toContain('showModal')
  })

  it('plays the embed without YouTube controls, with sound, driven over the IFrame API', () => {
    expect(player).toContain('youtubeEmbedSource(id, { controls: false, muted: false })')
    for (const func of ['playVideo', 'pauseVideo', 'seekTo', 'mute', 'unMute']) expect(player).toContain(`'${func}'`)
    expect(player).toContain('readYoutubeMessage(e, frame?.contentWindow, embed)')
    expect(player).toContain('Trailer unavailable')
  })

  it('takes Space, K and M, and steps the focused seek bar by 10 s from the pad or keyboard', () => {
    expect(player).toContain('<svelte:window onmessage={onMessage} onkeydowncapture={onKey} />')
    expect(player).toContain("const step = document.activeElement === seekbar && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')")
    expect(player).toContain('const STEP = 10')
    expect(player).toContain('use:focusOnOpen onclick={togglePlay}')
    expect(player).toContain('const hidden = $derived(idle && playing && dragTime === null)')
  })

  it('has a desktop-only setting row and search entry', () => {
    const page = read('../../../routes/app/settings/playback/+page.svelte')
    expect(page).toContain('<SettingsChoiceRow settingKey="trailers-open-in" title="Trailers open in"')
    expect(SETTINGS_SEARCH_INDEX.find((item) => item.key === 'trailers-open-in')).toMatchObject({
      title: 'Trailers open in', section: 'playback', subcategory: 'player-window', desktopOnly: true, hideOn: ['gamemode'],
    })
    expect(read('../../settings/ui.ts')).toContain("export const trailerOpenMode = persisted<TrailerOpenMode>('trailer-open-mode', 'player')")
  })
})
