import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const player = readFileSync(fileURLToPath(new URL('./AndroidPlayer.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

/** Every `<button …>` opening tag in `source`, scanned past `{…}` so `=>` never ends a tag early. */
function buttonTags(source: string): string[] {
  const tags: string[] = []
  for (let at = source.indexOf('<button'); at !== -1; at = source.indexOf('<button', at + 1)) {
    let depth = 0
    let end = at
    for (; end < source.length; end++) {
      const c = source[end]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push(source.slice(at, end + 1))
  }
  return tags
}

/** The body of the `$effect` that follows `anchor`. */
const effectAfter = (anchor: string) => {
  const start = player.indexOf('$effect(() => {', player.indexOf(anchor))
  return player.slice(start, player.indexOf('\n  })', start))
}

describe('Android and TV player styling hooks', () => {
  it('hooks the bars, the heading, the transport, the time and Skip', () => {
    for (const part of ['top', 'heading', 'title', 'transport', 'bottom', 'time', 'episode.number', 'episode.name']) {
      expect(player).toContain(`data-part="player.${part}"`)
    }
    expect(player).toContain('data-part="player.episode" data-episode={np.episode}')
    expect(player).toContain('data-season={episodeMeta?.season || undefined} data-season-episode={episodeMeta?.season ? episodeMeta.seasonEpisode ?? np.episode : undefined}')
    expect(player).toContain('data-part="player.time" data-variant="default"')
    expect(player).toContain('data-part="player.skip" data-kind={currentSeg.type}')
  })

  it('hooks the seek bar and its pieces', () => {
    expect(player).toMatch(/data-part="player\.seekbar" class="timeline-hitbox/)
    for (const piece of ['track', 'buffer', 'fill', 'knob', 'preview']) expect(player).toContain(`data-part="player.seekbar.${piece}"`)
  })

  it('names every control on the bars and keeps the TV play target', () => {
    for (const name of ['back', 'options', 'rewind', 'play', 'forward', 'fullscreen']) {
      expect(player).toContain(`data-part="player.control" data-control="${name}"`)
    }
    const bars = buttonTags(player.slice(player.indexOf('data-part="player.top"'), player.indexOf('data-part="player.seekbar"')))
    expect(bars).toHaveLength(6)
    for (const tag of bars) expect(tag, tag).toContain('data-control=')
    const play = player.split('\n').find((line) => line.includes('class="transport-button'))
    expect(play).toContain('data-tv-primary data-part="player.control" data-control="play"')
  })
})

describe('Android and TV player choices (theme API 6)', () => {
  it('reads the choices from the theme', () => {
    expect(player).toContain("import { themePresentation } from '$lib/themes/runtime'")
    expect(player).toContain('const playerControls = $derived(resolvePlayerControls($themePresentation))')
  })

  it('shows the time left, or elapsed and total, in the timeline row', () => {
    expect(player).toContain("{#if playerControls.time === 'default'}")
    expect(player).toContain('data-part="player.time" data-variant="elapsed"')
    expect(player).toContain("data-variant={playerControls.time === 'split' ? 'total' : 'remaining'}")
    expect(player).toContain(`{#if dur > 0}<span data-part="player.time" data-variant={playerControls.time === 'split' ? 'total' : 'remaining'}`)
    expect(player).toContain("{fmt(playerControls.time === 'split' ? dur : Math.max(0, dur - pos))}")
  })

  it('shows "E12" and the episode title, keyed per episode and hiding spoilers', () => {
    expect(player).toContain("{#if playerControls.title === 'episode'}")
    expect(player).toContain('loadEpisodeMeta(target.media, target.episode,')
    expect(player).toContain("const episodeKey = $derived(playerControls.title === 'episode' && $nowPlayingMedia?.episode")
    expect(player).toContain('episodeName(np.episode, episodeMeta, $hideSpoilers)')
  })

  it('shows the paused summary in place of the controls after five idle seconds', () => {
    expect(player).toContain("import PausedSummary from './PausedSummary.svelte'")
    expect(player).toContain('{#if pausedIdle}\n    <PausedSummary ')
    expect(player).toContain('function showControls() { untrack(() => { inputTick++ }); controlsShown = true; armHide() }')
    expect(player).toContain('$effect(() => { if (paused && !pausedIdle) { clearTimeout(hideTimer); controlsShown = true }')
    const idle = effectAfter('let pausedIdle = $state(false)')
    expect(idle).toContain("playerControls.paused === 'summary' && paused")
    for (const guard of ['landscape', 'firstFrameSeen', '!loading', '!recovering', '!atEof', '!locked', '!scrubbing', '!miniLayout',
      '!handover', '!resolvingNext', '!overlayHidden', '!sheet', '!subtitleEditorOpen', '!$upNextPrompt', '!$seriesRatingPrompt',
      '!$oskOpen', '!$navLayerOpen']) expect(idle, guard).toContain(guard)
    expect(idle).toContain('setTimeout(() => { pausedIdle = true; controlsShown = false }, 5000)')
    expect(idle).toContain('return () => clearTimeout(t)')
    // Svelte 5: the effect writes `pausedIdle` but never reads it, and only listens to input while armed.
    expect(idle.match(/pausedIdle(?! = )/g)).toBeNull()
    expect(idle.indexOf('if (!armed) return')).toBeLessThan(idle.indexOf('void inputTick'))
  })

  it('lets the first input after it only bring the controls back', () => {
    // Remote and keyboard: ahead of every other key handler, including the TV's Back on window.
    const keys = effectAfter('// The summary\'s first key only')
    expect(keys).toContain('if (!pausedIdle) return')
    expect(keys).toContain('event.stopImmediatePropagation()')
    // Back and the media keys keep acting (leave, play); only D-pad and OK are swallowed.
    expect(player).toContain("const SUMMARY_PASS_KEYS = new Set(['Escape', 'BrowserBack', 'GoBack', 'MediaPlayPause', 'MediaPlay', 'MediaPause'])")
    expect(keys).toContain('if (SUMMARY_PASS_KEYS.has(event.key)) { inputTick++; return }')
    expect(keys).toContain("window.addEventListener('keydown', dismiss, true)")
    expect(keys).toContain("return () => window.removeEventListener('keydown', dismiss, true)")
    // Touch: never reaches the tap, seek or drag handlers; any other touch restarts the wait.
    expect(player).toContain('onpointerdowncapture={onFrameDownCapture}')
    const touch = player.slice(player.indexOf('function onFrameDownCapture'), player.indexOf('function suppressGhostClick'))
    expect(touch).toContain('if (!pausedIdle) { inputTick++; return }')
    expect(touch).toContain('e.stopPropagation()')
    expect(touch).toContain('showControls()')
    // Every remote key that reaches the player restarts the wait.
    const tv = player.slice(player.indexOf('function onTvKeydown'), player.indexOf('function onPhoneSheetKeydown'))
    expect(tv).toContain('inputTick++\n    if (controlsShown) armHide()')
  })
})
