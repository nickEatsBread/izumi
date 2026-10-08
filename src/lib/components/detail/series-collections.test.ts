import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
const people = read('./RichMetadata.svelte')
const countdown = read('./AiringCountdown.svelte')
const list = read('./EpisodeList.svelte')

describe('series collections for themes', () => {
  it('names the headings and the grids of characters, staff and recommendations', () => {
    expect(people.match(/<h3 data-part="detail\.heading"/g)?.length).toBe(2)
    expect(people).toContain('<div data-part="detail.track" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">')
    expect(people).toContain('<div data-part="detail.track" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">')
    expect(people).toContain('<div data-slot="detail.recommended" data-part="detail.track" class="grid grid-cols-2 gap-4 sm:flex sm:flex-wrap">')
  })
  it('names each part of a voice actor credit', () => {
    expect(people).toContain("<svelte:element this={personHref(actor.id) ? 'a' : 'div'} data-part=\"person.voice\"")
    for (const hook of ['person.voice.photo', 'person.voice.name', 'person.voice.role']) {
      expect(people.match(new RegExp(`data-part="${hook.replaceAll('.', '\\.')}"`, 'g'))?.length, hook).toBe(1)
    }
  })
})

describe('series countdown formats', () => {
  it('keeps the API 3 formats as published themes select them', () => {
    // Published stylesheets select `> span` inside a long or compact countdown: the only child span
    // stays the time, now also named.
    const long = countdown.slice(countdown.indexOf("{#if variant === 'long'}"), countdown.indexOf("{:else if variant === 'compact'}"))
    expect(long.match(/<span/g)?.length).toBe(1)
    expect(long).toContain('Episode {next.episode} will be released in <span data-part="detail.countdown.time" class="text-theme">{longCountdown(seconds)}</span>')
    const compact = countdown.slice(countdown.indexOf("{:else if variant === 'compact'}"), countdown.indexOf("{:else if variant === 'words'}"))
    expect(compact.match(/<span/g)?.length).toBe(1)
    expect(compact).toContain('Episode {next.episode} in <span data-part="detail.countdown.time" class="tabular-nums text-foreground">{compactCountdown(seconds)}</span>')
  })
  it('renders the API 4 formats as a label and a time', () => {
    expect(countdown).toContain('<span data-part="detail.countdown.label">Episode {next.episode} airs in</span> <span data-part="detail.countdown.time" class="font-bold text-theme">{wordsCountdown(seconds)}</span>')
    expect(countdown).toContain('Episode {next.episode} will be released in</span>')
    expect(countdown).toContain('{fullCountdown(seconds)}</span>')
    expect(countdown).toContain('Next episode {next.episode}</span>')
    expect(countdown).toContain('{airingDate(airsAt)}</span>')
    expect(countdown.match(/data-part="detail\.countdown" data-variant=\{variant\}/g)?.length).toBe(5)
  })
  it('ticks each second for the full count and hides episodes beyond the theme window', () => {
    expect(countdown).toContain("variant === 'full' ? 1000 : 60_000")
    expect(countdown).toContain('const withinDays = $derived(within ?? resolveDetail($themePresentation).countdownWithin)')
    expect(countdown).toContain('{#if next && countdownShown(seconds, withinDays)}')
  })
  it('sits at the top of the episode list when the theme places it there', () => {
    expect(list).toContain("return detail.countdown && detail.countdown !== 'none' && at !== 'info' ? detail.countdown : undefined")
    const placed = list.indexOf('{#if listCountdown}<AiringCountdown {media} variant={listCountdown} className="mb-4" />{/if}')
    expect(placed).toBeGreaterThan(list.indexOf('data-slot="episodes.toolbar"'))
    expect(placed).toBeLessThan(list.indexOf('data-part="episode.continue"'))
  })
})

describe('the episode list opens where the viewer is up to', () => {
  it('opens pages, ranges and the range picker on the Play episode', () => {
    expect(list).toContain('const autoPage = $derived(openingPage(allEpisodes, PER, ctaEpisode, resumeThrough))')
    expect(list.indexOf('const ctaEpisode = $derived(offline')).toBeLessThan(list.indexOf('const autoPage'))
  })
  it('starts the carousel at the Play episode and leaves a row the viewer moved', () => {
    expect(list).toContain('const target = searchedEpisodes ? undefined : ctaEpisode')
    expect(list).toContain('const left = card.offsetLeft - first.offsetLeft')
    expect(list).toContain("const types = ['wheel', 'touchmove', 'keydown', 'focusin', 'pointerdown'] as const")
    // A tap on a card focuses it: that press is not a move, so the row still follows Play afterwards.
    expect(list).toContain("if (event.type === 'pointerdown' && event.target !== track) { pressedAt = performance.now(); return }")
    expect(list).toContain("if (event.type === 'focusin' && performance.now() - pressedAt < 1000) return")
  })
  it('places the row and the current range chip again as the theme layout settles', () => {
    // Fonts and theme sizes land after the first layout; a one-shot placement went stale.
    expect(list).toContain('const release = holdPlace(row, centre, () => moved)')
    expect(list).toContain('return holdPlace(track, () => place(false), () => trackMoved)')
    expect(list).toContain('const rangeCount = $derived(rangeChips.length)')
  })
  it('keeps the episode rows and range chips to sideways scrolling', () => {
    expect(list).toContain('data-part="episodes.track" class="flex gap-5 overflow-x-auto overflow-y-hidden pb-3"')
    expect(list).toContain('class="relative -mx-4 mb-4 flex gap-2 overflow-x-auto overflow-y-hidden px-4 pb-1')
  })
})

describe('the series Download button', () => {
  it('opens the download selection with its episode picked', () => {
    expect(list).toContain("import { onDownloadSelect } from '$lib/detail/episode-commands'")
    expect(list).toContain('$effect(() => onDownloadSelect(media.id, ({ episode }) => untrack(() => selectForDownload(episode))))')
    const select = list.slice(list.indexOf('function selectForDownload'), list.indexOf('function revealList'))
    expect(select).toContain('if (!selecting) startSelect()')
    expect(select).toContain('if (episode >= 1 && episode <= aired) selected = new Set([episode])')
    expect(select).toContain('void tick().then(revealList)')
  })
})
