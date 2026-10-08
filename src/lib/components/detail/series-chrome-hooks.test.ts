import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
const detail = read('./AnimeDetail.svelte')

describe('series page chrome for themes', () => {
  it('covers the phone bottom navigation while the page is open when the theme asks', () => {
    expect(detail).toContain("import { suppressBottomNav } from '$lib/shell/chrome'")
    expect(detail).toContain("if (!$isMobile || detailTheme.nav !== 'hidden') return")
    expect(detail).toContain('return suppressBottomNav()')
  })
  it('names the floating bar and the phone byline', () => {
    expect(detail.match(/<div data-slot="detail\.bar" data-solid=\{barState\.solid \|\| undefined\} bind:clientHeight=\{barHeight\}/g)?.length).toBe(2)
    expect(detail).toContain('<div data-part="detail.byline" class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/65">')
  })
  it('keys every fact', () => {
    expect(read('./FactList.svelte').match(/data-part="fact" data-key=\{fact\.key\}/g)?.length).toBe(3)
    // The desktop Overview's own three; the phone Information grid keys its facts from facts.ts.
    expect(detail.match(/data-part="fact" data-key="[a-z]+"/g)?.length).toBe(3)
    expect(detail.match(/data-part="fact" data-key=\{fact\.key\}/g)?.length).toBe(1)
    expect(detail).not.toContain('data-part="fact" class=')
    expect(detail).not.toContain('data-part="fact">')
  })
  it('names character and staff credits', () => {
    const people = read('./RichMetadata.svelte')
    for (const hook of ['person', 'person.photo', 'person.name', 'person.role']) {
      expect(people.match(new RegExp(`data-part="${hook.replace('.', '\\.')}"`, 'g'))?.length, hook).toBe(3)
    }
    // The staff grid is a region of its own, like the characters.
    expect(people).toContain('<section data-slot="detail.characters">')
    expect(people).toContain('<section data-slot="detail.staff">')
  })
  it('names each series action', () => {
    // Save and Share keep their `button` part (Save also on the desktop overlay page); Trailer and
    // More have no part of their own, so they are `detail.action`. The list buttons say `list`.
    expect(detail.match(/data-part="button" data-variant="secondary" data-action="save"/g)?.length).toBe(3)
    expect(detail.match(/data-part="button" data-variant="icon" data-action="share"/g)?.length).toBe(2)
    expect(detail.match(/data-part="detail\.action" data-action="trailer"/g)?.length).toBe(2)
    expect(detail.match(/data-part="detail\.action" data-action="more"/g)?.length).toBe(1)
    expect(detail.match(/data-part="detail\.list-button"[^>]*? data-action="list"/g)?.length).toBe(3)
    expect(detail.match(/data-part="detail\.list-button"/g)?.length).toBe(3)
  })
  it('labels related titles with their relation on phones as on desktop', () => {
    expect(detail.match(/<div data-part="relation\.type" class="[^"]*">\{e\.relationType\.replaceAll\('_', ' '\)\.toLowerCase\(\)\}<\/div>/g)?.length).toBe(2)
  })
  it('names the scrolling row of a carousel episode list', () => {
    expect(read('./EpisodeList.svelte')).toContain('<div data-part="episodes.track" class="flex gap-5 overflow-x-auto overflow-y-hidden pb-3" bind:this={episodeTrack}>')
  })
})
