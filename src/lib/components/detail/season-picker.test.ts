import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url))
const list = readFileSync(path('./EpisodeList.svelte'), 'utf8')

describe('season picker', () => {
  it('loads the prequel/sequel chain once per title', () => {
    // The import also brings the format gate below.
    expect(list).toContain("import { fetchSeasonChain, mayListSeasons, seasonEntries, type SeasonEntry } from '$lib/anilist/seasons'")
    expect(list).toContain('const seed = untrack(() => (media.catalog ? undefined : media))')
    expect(list).toContain('fetchSeasonChain(root, seed)')
    expect(list).toContain('seasonList = seasonEntries(chain, root)')
  })
  it('walks the chain only for a title that can be a season (not a film, OVA or special)', () => {
    expect(list).toContain("const seasonRoot = $derived(seasonStyle === 'none' || offline || !mayListSeasons(media.format) ? undefined : anilistIdOf(media))")
  })
  it('renders chips, posters or a dropdown with hooks', () => {
    expect(existsSync(path('./SeasonPicker.svelte'))).toBe(true)
    const picker = readFileSync(path('./SeasonPicker.svelte'), 'utf8')
    for (const hook of ['data-slot="episodes.seasons"', 'data-part="season"', 'data-part="season.art"', 'data-part="season.label"', 'data-part="season.year"', 'data-part="season.toggle"', 'data-part="episodes.menu" data-variant="seasons"']) {
      expect(picker, hook).toContain(hook)
    }
    expect(picker).toContain('href={mediaHref(entry.media)}')
    expect(picker).toContain('data-active={entry.active || undefined}')
  })
  it('puts the dropdown in a heading toolbar in place of the Episodes heading', () => {
    expect(list).toContain('lead={seasonsInHeader ? seasonLead : undefined}')
    expect(list).toContain('{#if seasonList.length > 1 && !seasonsInHeader}')
  })
  it('portals the season list the way the episode toolbar portals its menus', () => {
    expect(existsSync(path('./SeasonPicker.svelte'))).toBe(true)
    const picker = readFileSync(path('./SeasonPicker.svelte'), 'utf8')
    const bar = readFileSync(path('./EpisodeToolbar.svelte'), 'utf8')
    // One placement helper for every episode menu, so their zoom handling cannot drift apart. They
    // share the helper that scrolls a list to its chosen entry too.
    for (const source of [picker, bar]) expect(source).toContain("import { anchoredMenuStyle, centreInList } from '$lib/components/menu-anchor'")
    expect(picker).toContain('<div use:portal bind:this={panel} data-part="episodes.menu" data-variant="seasons" data-nav-trap data-nav-escape style={place}')
    expect(picker).toContain("window.addEventListener('pointerdown', outside, true)")
    expect(picker).toContain("if (event.key === 'Escape' && open) { event.preventDefault(); close(true) }")
  })
  it('opens the list on the current season, scrolled into view inside the list only', () => {
    const picker = readFileSync(path('./SeasonPicker.svelte'), 'utf8')
    expect(picker).toContain('data-variant="seasons" data-nav-trap data-nav-escape style={place} data-nav-scroll-container')
    expect(picker).toContain('centreInList(panel, entry)')
    expect(picker).toContain('entry?.focus({ preventScroll: true })')
  })
})
