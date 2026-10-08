import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('card extras', () => {
  it('binds the time left on resume cards', () => {
    const card = read('./ContinueCard.svelte')
    expect(card).toContain("import { episodeDisplayModel, seriesRatingText, timeLeftLabel } from '$lib/themes/host-model'")
    expect(card).toContain('timeLeft: timeLeftLabel(savedPosition),')
  })

  it('binds the series score and the watched count on resume cards', () => {
    const card = read('./ContinueCard.svelte')
    expect(card).toContain('rating: seriesRatingText(media),')
    expect(card).toContain('episodesWatched: progress,')
  })

  it('keeps the resolving spinner over a continue template, and only while it resolves', () => {
    const card = read('./ContinueCard.svelte')
    const templated = card.slice(card.indexOf('{#if continueTemplate}'), card.indexOf('{:else}', card.indexOf('{#if continueTemplate}')))
    expect(templated).toContain('<ThemeNode node={continueTemplate} model={continueModel} />')
    expect(templated).toMatch(/\{#if resolving\}\s*<span data-part="card\.overlay" data-state="resolving" class="pointer-events-none absolute inset-0[^"]*">/)
    expect(templated).toContain('<Loader size={22} class="animate-spin" />')
    // The card is the overlay's frame only under a template; izumi's own card keeps its layout.
    expect(card).toContain("{continueTemplate ? 'relative' : ''}")
    expect(card).toContain(`data-part="card.overlay" data-state={resolving ? 'resolving' : undefined}`)
  })

  it('binds the watched count and the finished mark on poster templates only', () => {
    const card = read('./SmallCard.svelte')
    expect(card).toContain("import { seriesCompletion, seriesProgress } from '$lib/themes/series-progress'")
    expect(card).toMatch(/const cardModel = \$derived\(cardTemplate \? mediaDisplayModel\(media, \{[\s\S]*?episodesWatched: \$seriesProgress\(media\),[\s\S]*?\}, coverWidth\) : undefined\)/)
    expect(card).toMatch(/const cardModel = \$derived\(cardTemplate \? mediaDisplayModel\(media, \{[\s\S]*?completed: \$seriesCompletion\(media\) \? 'Completed' : undefined,[\s\S]*?\}, coverWidth\) : undefined\)/)
    expect(card).toContain('<ThemeNode node={cardTemplate} model={cardModel} />')
    expect(card.match(/\$seriesProgress/g)).toHaveLength(1)
    expect(card.match(/\$seriesCompletion/g)).toHaveLength(1)
  })

  it('lets a theme switch the hover popup off', () => {
    const card = read('./SmallCard.svelte')
    expect(card).toContain("const previewOff = $derived(simpleHover || $themePresentation?.cardPreview === 'none')")
    expect(card).toContain('function open() { if (previewOff ||')
    expect(card).toContain('{#if hovered && !previewOff}')
  })
})
