import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const tagList = readFileSync(fileURLToPath(new URL('./MediaTagList.svelte', import.meta.url)), 'utf8')
const animeDetail = readFileSync(fileURLToPath(new URL('./AnimeDetail.svelte', import.meta.url)), 'utf8')
const readingDetail = readFileSync(fileURLToPath(new URL('./ReadingDetail.svelte', import.meta.url)), 'utf8')

describe('detail-screen spoiler tags', () => {
  it('obscures flagged tag text until an explicit, reversible reveal', () => {
    expect(tagList).toContain('{#if isSpoilerTag(tag)}')
    expect(tagList).toContain("'Reveal spoiler tag'")
    expect(tagList).toContain('aria-pressed={revealed.has(tag.name)}')
    expect(tagList).toContain('if (next.has(name)) next.delete(name)')
    expect(tagList).toContain('blur-[6px]')
    expect(tagList).toContain('spoiler-pixels')
  })

  it('shows the reveal prompt only while the concealed chip is hovered or focused', () => {
    expect(tagList).toContain('Spoiler tag · reveal')
    expect(tagList).toContain('bottom-full left-1/2')
    expect(tagList).toContain('group-hover:opacity-100 group-focus-visible:opacity-100')
  })

  it('uses the real label width in both states so revealing cannot reflow the tag row', () => {
    expect(tagList).not.toContain('min-w-36')
    expect(tagList).toContain('class="pointer-events-none select-none whitespace-nowrap blur-[6px]')
  })

  it('uses the protected list on anime and reading detail screens', () => {
    expect(animeDetail.match(/<MediaTagList/g)).toHaveLength(2)
    expect(readingDetail).toContain('<MediaTagList tags={m.tags} showRank />')
    expect(animeDetail).not.toContain('filter((tag) => !tag.isMediaSpoiler)')
    expect(readingDetail).not.toContain('filter((tag) => !tag.isMediaSpoiler)')
  })
})

describe('tag chips', () => {
  it('makes every tag, spoiler or not, a chip carrying its rank', () => {
    expect(tagList.match(/data-part="chip"\s+data-rank=\{tag\.rank \|\| undefined\}/g)).toHaveLength(2)
    expect(tagList).toContain('<span data-part="chip" data-rank={tag.rank || undefined} class="rounded-full bg-secondary/55 px-3 py-1.5 text-xs font-semibold text-foreground/80">')
  })

  it('keeps the rank in a chip.meta part, hidden unless the page prints ranks', () => {
    expect(tagList).toContain(`{#snippet rank(tag: MediaTag)}{showRank && tag.rank ? ' · ' : ''}{#if tag.rank}<span data-part="chip.meta" class={showRank ? undefined : 'hidden'}>{tag.rank}%</span>{/if}{/snippet}`)
    // Every place a tag name is drawn ends with it: plain tags, and spoiler tags open or veiled.
    expect(tagList.match(/\{tag\.name\}\{@render rank\(tag\)\}/g)).toHaveLength(3)
    expect(tagList).not.toContain('` · ${tag.rank}%`')
  })
})

describe('alternative titles', () => {
  it('draws each title as its own chip, joined by a dot a theme can drop', () => {
    expect(animeDetail).toContain(`{#each m.synonyms as synonym, index (index)}<span data-part="chip" class={index ? "before:content-['_·_']" : undefined}>{synonym}</span>{/each}`)
    // The Overview block no longer prints one joined string; the desktop Details fact still does.
    expect(animeDetail.match(/m\.synonyms\.join\(' · '\)/g)).toHaveLength(1)
    expect(animeDetail).toContain('<div data-part="fact" data-key="synonyms"')
  })
})
