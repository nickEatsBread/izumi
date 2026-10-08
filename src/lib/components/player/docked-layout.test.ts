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
    expect(overlay).toContain('playerStage.set(measureStage(root.getBoundingClientRect(), probe.getBoundingClientRect(), flow))')
    expect(overlay).toContain('new ResizeObserver(measure)')
  })

  it('shares one navigation placement between the shell and the player', () => {
    expect(read('../../themes/runtime.ts')).toContain('export const shellNav = derived([isMobile, isTv, themePresentation]')
    expect(layout).not.toContain("const shellNav = $derived(")
  })
})

describe('full-bleed banners follow the shell margin', () => {
  // The series page draws its desktop banner through Hero, while loading too: it has no breakout of its own.
  it('offsets the banner by the sidebar width only when there is a sidebar', () => {
    // A fixed -left-14 with a top or bottom navigation bar (margin 0) left a 56px band at the right.
    expect(read('../detail/AnimeDetail.svelte')).not.toContain('sm:-left-14')
    for (const file of ['../banner/Hero.svelte']) {
      const source = read(file)
      expect(source).toContain('left-[calc(-1*var(--theme-shell-left,0px))] top-0 h-[calc(100%+2rem)] w-screen overflow-hidden')
      expect(source).not.toContain('sm:-left-14')
    }
  })

  it('reaches up under the whole top bar, not just the titlebar', () => {
    // A 2rem reach under a transparent top bar left a band of page background above the artwork.
    expect(read('../detail/AnimeDetail.svelte')).not.toContain('sm:-top-8')
    for (const file of ['../banner/Hero.svelte']) {
      const source = read(file)
      expect(source).toContain('sm:top-[calc(-1*var(--theme-shell-top,2rem))] sm:h-[calc(100%+var(--theme-shell-top,2rem))]')
      expect(source).not.toContain('sm:-top-8')
    }
    const css = read('../../../app.css')
    expect(css).toContain("html[data-theme-nav='top'] { --theme-shell-top: 4.75rem; }")
  })
})

describe('docked watch layout', () => {
  it('keeps the whole container on phones, in fullscreen, picture-in-picture and Game mode', () => {
    expect(overlay).toContain('const docked = $derived(dock.docked && windowedChrome && !$isMobile)')
    expect(overlay).toContain('const windowedChrome = $derived(!$fullscreen && !gmMode && !$pictureInPicture)')
  })

  it('mounts the video in a stage sized by the theme with the episode rail beside or below it', () => {
    expect(overlay).toContain("style:width={pageFlow ? `${dock.width}%` : docked && dock.episodes !== 'below' ? `${dock.width}%` : undefined}")
    expect(overlay).toContain('<DockEpisodes orientation="right" />')
    expect(overlay).toContain('<DockEpisodes orientation="below" scroll={false} />')
    expect(overlay).toContain("dock.episodes === 'below' ? 'w-full border-t' : 'h-full border-l'")
    // The root keeps its identity (capture, Game mode focus rules and the HUD all key off it).
    expect(overlay).toContain('class="izumi-player-root {docked ?')
  })

  it('never paints over the transparent video hole: no background on the root or its ancestors', () => {
    // The webview is transparent over mpv; an opaque wrapper or root showed a black stage with sound.
    expect(overlay).toContain("class={pageFlow && !columnFlow ? 'izumi-player-dock fixed z-20 overflow-y-auto overscroll-contain' : docked ? `izumi-player-dock fixed z-20 flex ${dock.episodes === 'below' ? 'flex-col' : 'flex-row'}` : 'contents'}")
    expect(overlay).not.toContain('izumi-player-dock fixed z-20 flex bg-background')
    expect(overlay).toContain("class=\"izumi-player-root {docked ? 'relative aspect-video shrink-0 overflow-hidden' : 'fixed inset-y-0 right-0'}")
    expect(overlay).not.toContain("'relative aspect-video shrink-0 overflow-hidden bg-black'")
    // Opaque siblings cover everything that is not the stage.
    expect(overlay).toContain('class="izumi-player-under min-h-0 flex-1 border-t border-border bg-background"')
    expect(overlay).toContain('<div class="min-w-0 flex-1 bg-background" aria-hidden="true"></div>')
  })

  it('puts the episode discussion under the stage unless the theme hides it', () => {
    expect(read('../../themes/presentation.ts')).toContain("const comments = player?.dock?.comments ?? 'below'")
    expect(overlay).toContain("{#if dock.comments === 'below'}<CommentsPanel inline />{/if}")
    const comments = read('./CommentsPanel.svelte')
    expect(comments).toContain('let { inline = false, expand = false, tiles }: { inline?: boolean; expand?: boolean; tiles?: boolean } = $props()')
    expect(comments).toContain('if (!inline && !$commentsOpen) return')
    expect(comments).toContain(`<div data-slot="watch.comments" data-variant="inline" data-comments-panel data-comments-inline class="flex flex-col bg-background text-foreground {expand ? '' : 'h-full min-h-0'}">`)
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

describe('page-flow watch view', () => {
  it('scrolls the view with the video in it, and the native video follows on Windows', () => {
    expect(read('../../themes/presentation.ts')).toContain("flow: episodes === 'below' ? player?.dock?.flow ?? 'fixed' : comments === 'below' ? player?.dock?.flow ?? 'page' : 'fixed',")
    expect(overlay).toContain("const pageFlow = $derived(docked && dock.flow === 'page' && $isWindows)")
    expect(overlay).toContain("scroller?.addEventListener('scroll', measure, { passive: true })")
    expect(read('../../player/insets.ts')).toContain('export function measureStage(stage: DOMRectReadOnly, viewport: DOMRectReadOnly, scrolls = false)')
    const lib = read('../../../../src-tauri/src/lib.rs')
    expect(lib).toContain('let t = MPV_INSET_TOP.load(Ordering::Relaxed).clamp(-offscreen, ch);')
    expect(lib).toContain('let b = MPV_INSET_BOTTOM.load(Ordering::Relaxed).clamp(-offscreen, ch - t);')
  })

  it('keeps the scroller and column transparent and paints the page around the stage', () => {
    // Both are ancestors of the video hole: the stage's spread shadow is the page background instead.
    expect(overlay).toContain("style:box-shadow={pageFlow ? '0 0 0 200vmax hsl(var(--background))' : undefined}")
    expect(overlay).toContain('<div data-part="watch.block" data-block={block} class="relative z-[21]">')
    expect(overlay).toContain(": pageFlow ? 'izumi-player-page flex flex-col pb-8' :")
  })

  it('lays the blocks out under the video with a discussion as tall as its comments', () => {
    expect(overlay).toContain('<CommentsPanel inline expand />')
    const comments = read('./CommentsPanel.svelte')
    expect(comments).toContain('expand ? mobileEmbedSrc(disqusEmbedSrc(embedUrl)) : disqusEmbedSrc(embedUrl)')
    expect(comments).toContain("style:height={expand ? `${disqusHeight ?? 720}px` : undefined}")
    expect(comments).toContain("class={expand ? 'px-3 py-3' : 'flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 py-3'}")
  })

  it('beside a side rail scrolls the video column with the discussion under it, not the discussion alone', () => {
    expect(overlay).toContain("const columnFlow = $derived(pageFlow && dock.episodes !== 'below')")
    // The column is the scroller (the dock stays a plain row) and the native video follows it.
    expect(overlay).toContain("class={columnFlow ? 'izumi-player-page flex h-full shrink-0 flex-col overflow-y-auto overscroll-contain'")
    expect(overlay).toContain('bind:this={dockColumn}')
    expect(overlay).toContain('const scroller = !flow ? undefined : columnFlow ? dockColumn : dockScroller')
    // The discussion takes its comments' height inside that column; the rail keeps its own list.
    const column = overlay.slice(overlay.indexOf('{#if columnFlow}'), overlay.indexOf('{:else if pageFlow}'))
    expect(column).toContain('<div data-part="watch.block" data-block="comments" data-theme-surface="player-rail" class="izumi-player-under relative z-[21] grow border-t border-border bg-background">')
    // Same width as the fixed panel, so the reactions keep their compact chips (a full-width page
    // discussion shows tiles).
    expect(column).toContain('<CommentsPanel inline expand tiles={false} />')
    expect(read('./CommentsPanel.svelte')).toContain('expanded: (tiles ?? expand) || $discussionExpanded || $gameMode')
    expect(overlay).toMatch(/\{#if docked && \(!pageFlow \|\| columnFlow\)\}\r?\n {2}<aside data-slot="watch\.rail"/)
    // The video still fits the visible column, so its controls are on screen before any scroll.
    expect(overlay).toContain("style:max-height={docked && (!pageFlow || columnFlow) ? '100%' : undefined}")
    // A theme's width, not the page column's cap, sizes it beside the rail.
    expect(overlay).toContain("style:max-width={pageFlow && !columnFlow && dock.maxWidth ? `${dock.maxWidth}px` : undefined}")
  })

  it('starts a newly picked episode at the top of the page, but keeps the place on a server swap', () => {
    const effect = overlay.slice(overlay.indexOf("let pageEpisode = ''"), overlay.indexOf('let lastDrmError'))
    expect(effect).toContain('const key = `${np.id ?? \'\'}|${np.episode ?? \'\'}`')
    expect(effect).toContain('const scroller = !pageFlow ? undefined : columnFlow ? dockColumn : dockScroller')
    expect(effect).toContain('scroller?.scrollTo({ top: 0 })')
  })

  it('lets a wheel or a vertical drag over the video scroll the page', () => {
    // The full-window player cuts scroll chaining at the video; on a page-flow view the video is
    // part of the page, so the wheel over it has to reach the scroller.
    expect(overlay).toContain('class:overscroll-none={!pageFlow}')
    expect(overlay).toContain('class:touch-none={!pageFlow && !$commentsOpen}')
    expect(overlay).toContain('class:touch-pan-y={pageFlow && !$commentsOpen}')
    expect(overlay).not.toContain("z-20 overscroll-none select-none")
  })

  it('backs a translucent top bar so the scrolled video never shows through it', () => {
    expect(overlay).toContain("{#if pageFlow && $shellNav === 'top'}")
    expect(overlay).toContain('<div aria-hidden="true" class="pointer-events-none fixed inset-x-0 top-0 z-20 h-[4.75rem] bg-background"></div>')
  })

  it('lets a docked theme drop the player chrome it shows elsewhere', () => {
    expect(overlay).toContain("hideBack={hides('back')} hideTitle={hides('title')}")
    const controls = read('./Controls.svelte')
    expect(controls).toContain('{#if np.animeTitle && !hideTitle}')
    expect(controls).toContain('{#if !gm && !hideBack}')
  })
})
