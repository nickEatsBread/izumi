// Source contracts for the themeable watch layout: the player root is inset from the edge the
// navigation actually occupies, and a theme's docked layout mounts the video in a measured stage
// with the episode rail beside or below it — on every native embed.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const overlay = read('./PlayerOverlay.svelte')
const layout = read('../../../routes/app/+layout.svelte')

describe('player mount follows the navigation placement', () => {
  it('no longer insets the left edge unconditionally while windowed', () => {
    expect(overlay).not.toContain("class:left-14={!$fullscreen && !gmMode && !$pictureInPicture}")
    expect(overlay).toContain("class:left-14={!docked && windowedChrome && $shellNav === 'sidebar'}")
    expect(overlay).toContain("style:top={!docked && windowedChrome && $shellNav === 'top' ? '4.75rem' : undefined}")
    expect(overlay).toContain("style:bottom={!docked && windowedChrome && $shellNav === 'bottom' ? bottomNavInset : undefined}")
  })

  it('sends measured insets for every edge instead of a fixed sidebar width', () => {
    expect(layout).not.toContain("invoke('player_set_inset', { left, top: 0 })")
    expect(layout).toContain("invoke('player_set_inset', { ...insets })")
    expect(layout).toContain('stage: $playerStage')
    expect(layout).toContain('nav: $shellNav')
    expect(overlay).toContain('playerStage.set(measureStage(root.getBoundingClientRect(), probe.getBoundingClientRect()))')
    expect(overlay).toContain('new ResizeObserver(measure)')
  })

  it('shares one navigation placement between the shell and the player', () => {
    expect(read('../../themes/runtime.ts')).toContain('export const shellNav = derived([isMobile, isTv, themePresentation]')
    expect(layout).not.toContain("const shellNav = $derived(")
  })
})

describe('full-bleed banners follow the shell margin', () => {
  it('offsets the banner by the sidebar width only when there is a sidebar', () => {
    // A fixed -left-14 with a top or bottom navigation bar (margin 0) left a 56px band at the right.
    for (const file of ['../banner/Hero.svelte', '../detail/AnimeDetail.svelte']) {
      const source = read(file)
      expect(source).toContain('left-[calc(-1*var(--theme-shell-left,0px))] top-0 h-[calc(100%+2rem)] w-screen overflow-hidden sm:-top-8')
      expect(source).not.toContain('sm:-left-14')
    }
  })
})

describe('docked watch layout', () => {
  it('keeps the whole container on phones, in fullscreen, picture-in-picture and Game mode', () => {
    expect(overlay).toContain('const docked = $derived(dock.docked && windowedChrome && !$isMobile)')
    expect(overlay).toContain('const windowedChrome = $derived(!$fullscreen && !gmMode && !$pictureInPicture)')
  })

  it('mounts the video in a stage sized by the theme with the episode rail beside or below it', () => {
    expect(overlay).toContain("style:width={docked && dock.episodes !== 'below' ? `${dock.width}%` : undefined}")
    expect(overlay).toContain('<DockEpisodes orientation="right" />')
    expect(overlay).toContain('<DockEpisodes orientation="below" scroll={false} />')
    expect(overlay).toContain("dock.episodes === 'below' ? 'w-full border-t' : 'h-full border-l'")
    // The root keeps its identity (capture, Game mode focus rules and the HUD all key off it).
    expect(overlay).toContain('class="izumi-player-root {docked ?')
  })

  it('never paints over the transparent video hole: no background on the root or its ancestors', () => {
    // The webview is transparent over mpv; an opaque wrapper or root showed a black stage with sound.
    expect(overlay).toContain("class={docked ? `izumi-player-dock fixed z-20 flex ${dock.episodes === 'below' ? 'flex-col' : 'flex-row'}` : 'contents'}")
    expect(overlay).not.toContain('izumi-player-dock fixed z-20 flex bg-background')
    expect(overlay).toContain("class=\"izumi-player-root {docked ? 'relative aspect-video shrink-0 overflow-hidden' : 'fixed inset-y-0 right-0'}")
    expect(overlay).not.toContain("'relative aspect-video shrink-0 overflow-hidden bg-black'")
    // Opaque siblings cover everything that is not the stage.
    expect(overlay).toContain('class="izumi-player-under min-h-0 flex-1 border-t border-border bg-background"')
    expect(overlay).toContain('<div class="min-w-0 flex-1 bg-background" aria-hidden="true"></div>')
  })

  it('puts the episode discussion under the stage unless the theme hides it', () => {
    expect(read('../../themes/presentation.ts')).toContain("comments: player?.dock?.comments ?? 'below'")
    expect(overlay).toContain("{#if dock.comments === 'below'}<CommentsPanel inline />{/if}")
    const comments = read('./CommentsPanel.svelte')
    expect(comments).toContain('let { inline = false }: { inline?: boolean } = $props()')
    expect(comments).toContain('if (!inline && !$commentsOpen) return')
    expect(comments).toContain('<div data-comments-panel data-comments-inline class="flex h-full min-h-0 flex-col bg-background text-foreground">')
  })

  it('gives every native embed right and bottom insets', () => {
    const lib = read('../../../../src-tauri/src/lib.rs')
    expect(lib).toContain('static MPV_INSET_RIGHT')
    expect(lib).toContain('static MPV_INSET_BOTTOM')
    expect(lib).toMatch(/fn player_set_inset\(\s*app: AppHandle,\s*left: i32,\s*top: Option<i32>,\s*right: Option<i32>,\s*bottom: Option<i32>,\s*\)/)
    expect(lib).toContain('(l, t, (cw - l - r).max(1), (ch - t - b).max(1))')
    expect(read('../../../../src-tauri/src/player/macos_geometry.rs')).toContain('let width = (content_w - left - right).max(1.0);')
    const linux = read('../../../../src-tauri/src/player/linux_embed.rs')
    expect(linux).toContain('pub fn set_inset(window: &tauri::WebviewWindow, left: i32, top: i32, right: i32, bottom: i32)')
    expect(linux).toContain('fn video_layout(window: (i32, i32), csd: (i32, i32)) -> ((i32, i32), (i32, i32))')
  })

  it('plays a picked episode through the same route as the Next button', () => {
    expect(read('../../stremio/play.ts')).toContain('export function playEpisodeInPlayer(media: Media, episode: number')
    const rail = read('./DockEpisodes.svelte')
    expect(rail).toContain('await playEpisodeInPlayer(media, n)')
    expect(rail).toContain("{ autoplay: true, startSeconds }")
  })
})
