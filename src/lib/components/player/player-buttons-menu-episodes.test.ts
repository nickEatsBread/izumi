import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PLAYER_CONTROLS } from '$lib/settings/ui'
import { SETTINGS_SEARCH_INDEX } from '$lib/settings/search'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const controls = read('./Controls.svelte')
const overlay = read('./PlayerOverlay.svelte')
const cast = read('./DesktopCastButton.svelte')
const menu = read('./PlayerContextMenu.svelte')
const panel = read('./PlayerEpisodes.svelte')
const ui = read('../../settings/ui.ts')
const settings = read('../../../routes/app/settings/playback/+page.svelte')

describe('Player buttons setting', () => {
  it('lists only optional buttons and starts with the Episodes switcher hidden', () => {
    expect(PLAYER_CONTROLS.map((control) => control.id)).toEqual(['episode-nav', 'discussion', 'episodes', 'cast', 'screenshot', 'miniplayer'])
    expect(ui).toContain("persisted<PlayerControlId[]>('player-hidden-controls', ['episodes'])")
  })

  it('gates each optional bar button on the setting', () => {
    expect(controls).toContain("{#if hasPrev && !hiddenControls.has('episode-nav')}")
    expect(controls).toContain("{#if hasNext && !hiddenControls.has('episode-nav')}")
    expect(controls).toContain("{#if !hiddenControls.has('discussion')}")
    expect(controls).toContain("{#if !gm && hasEpisodes && !hiddenControls.has('episodes')}")
    expect(controls).toContain(`{#if !hiddenControls.has('screenshot')}<button data-part="player.control" data-control="screenshot" data-focusable class={iconBtn} onclick={screenshot}`)
    expect(controls).toContain(`{#if !hiddenControls.has('miniplayer')}<button data-part="player.control" data-control="pip" data-focusable class={iconBtn} onclick={togglePictureInPicture}`)
  })

  it('keeps a hidden Cast button mounted so the right-click menu can still open its list', () => {
    expect(controls).toContain("<DesktopCastButton bind:this={castButton} hidden={hiddenControls.has('cast')}")
    expect(cast).toContain('export function toggle()')
    expect(cast).toContain("{#if !hidden}")
    expect(cast).toContain("window.addEventListener('player-menu-close', onMenuClose)")
  })

  it('lives in Playback › Player window with a search entry, as neutral chips', () => {
    expect(settings).toContain('settingKey="player-buttons" title="Player buttons"')
    expect(settings).toContain('aria-pressed={shown(control.id)} onclick={() => toggleControl(control.id)}')
    expect(settings).not.toMatch(/toggleControl[\s\S]{0,400}bg-theme/)
    const hit = SETTINGS_SEARCH_INDEX.find((item) => item.key === 'player-buttons')
    expect(hit).toMatchObject({ section: 'playback', subcategory: 'player-window', desktopOnly: true })
  })
})

describe('right-click menu', () => {
  it('opens from the overlay on desktop only and hands the point to Controls', () => {
    expect(overlay).toContain('oncontextmenu={onOverlayContextMenu}')
    expect(overlay).toMatch(/async function onOverlayContextMenu[\s\S]*?if \(gmMode \|\| \$pictureInPicture/)
    expect(overlay).toContain("window.dispatchEvent(new CustomEvent('player-context-menu', { detail: point }))")
    expect(controls).toContain("window.addEventListener('player-context-menu', onContextMenu)")
    expect(controls).toContain('{#if menuAt && root && !gm}')
  })

  it('closes on Escape before Escape can leave fullscreen', () => {
    const escape = overlay.indexOf("if (e.key === 'Escape' && get(playerMenuOpen))")
    expect(escape).toBeGreaterThan(-1)
    expect(escape).toBeLessThan(overlay.indexOf("const action = findHotkey(e, get(hotkeyBindings), 'Player')"))
    expect(controls).toContain("window.addEventListener('player-menu-close', closePlayerMenus)")
    expect(controls).toMatch(/function closePlayerMenus\(\) \{[\s\S]*?showEpisodes = false\s+menuAt = null/)
  })

  it('closes on click-away and on a pick, and keeps the bar up while open', () => {
    expect(menu).toContain('onclick={onclose} aria-label="Close menu"')
    expect(menu).toMatch(/function choose\(run: \(\) => void\) \{\s+onclose\(\)\s+run\(\)/)
    expect(controls).toContain('playerMenuOpen.set(showOptions || showTracks || showEpisodes || !!menuAt)')
  })

  it("runs the bar buttons' own handlers with the user's hotkey hints", () => {
    expect(controls).toContain("const hint = (id: HotkeyId) => displayBinding(effectiveBinding(id, $hotkeyBindings, $isMacOS), $isMacOS)")
    for (const piece of [
      "hint: hint('playerPlayPause'), run: togglePlay",
      "run: () => playNext(undefined, !paused)",
      "run: () => playPrev(undefined, !paused)",
      "{ label: 'Episodes', icon: ListVideo, run: toggleEpisodes }",
      'run: () => setSpeed(s)',
      "run: () => void loadTracks()",
      'castButton?.toggle()',
      "hint: hint('playerScreenshot'), divider: true, run: screenshot",
      'run: togglePictureInPicture',
      "hint: hint('playerFullscreen'), run: toggleFullscreen",
      "hint: hint('playerStats')",
    ]) expect(controls).toContain(piece)
  })

  it('is plain HTML positioned inside the player, converting screen px to local px', () => {
    expect(menu).toContain('const scale = rect.width > 0 ? root.clientWidth / rect.width : 1')
    expect(menu).not.toMatch(/WebviewWindow|new Window|invoke\(/)
  })
})

describe('episode panel', () => {
  it('plays a picked episode through the dock rail route and closes', () => {
    expect(panel).toContain('await playEpisodeInPlayer(media, n)')
    expect(panel).toContain('onclick={onclose} aria-label="Close episodes"')
    expect(controls).toContain('{#if showEpisodes && !gm}<PlayerEpisodes onclose={() => (showEpisodes = false)} />{/if}')
  })

  it('stays neutral: no theme accent on the panel', () => {
    expect(panel).not.toMatch(/theme/)
  })
})
