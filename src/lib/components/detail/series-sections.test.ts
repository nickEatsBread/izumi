import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
const detail = read('./AnimeDetail.svelte')

describe('series page sections', () => {
  it('resolves tabs, names and the default tab from the theme', () => {
    // The same import also brings `episodesOnPage` (the phone Play button's rule, continue-card.test.ts).
    expect(detail).toContain("resolveSections, type ResolvedSections } from '$lib/detail/sections'")
    expect(detail).toContain('const mobileTabs = $derived(resolveSections(detailTheme.sections, { phone: true, episodesTabbed: episodeTabbed }))')
    expect(detail).toContain('const desktopTabs = $derived(resolveSections(detailTheme.sections, { phone: false, episodesTabbed: episodeTabbed }))')
    expect(detail).toContain("let pickedTab = $state('')")
    expect(detail).toContain('view.tabs.find((tab) => tab === pickedTab) ?? view.initial')
    expect(detail).not.toContain("let active = $state('Episodes')")
  })
  it("renders every layout's sections through one snippet", () => {
    expect(detail.match(/\{@render detailSections\(m, /g)?.length).toBe(4)
    expect(detail).toContain('{#snippet detailSections(m: Media, phone: boolean, overlay: boolean)}')
    expect(detail).toContain('{#snippet sectionBody(m: Media, id: DetailSection, phone: boolean, overlay: boolean)}')
    expect(detail.match(/data-slot="detail\.section"/g)?.length).toBe(2)
    expect(detail.match(/data-part="detail\.section-title"/g)?.length).toBe(2)
    expect(detail).toContain('data-section={id}')
    expect(detail.match(/<Tabs /g)?.length).toBe(2)
    expect(detail).toContain('labels={view.labels}')
  })
  it('moves the phone facts into Overview when the theme asks', () => {
    expect(detail).toContain('{#snippet phoneInfo(m: Media)}')
    expect(detail).toContain('{#if !mobileTabs.infoInOverview}{@render phoneInfo(m)}{/if}')
    expect(detail).toContain('{#if mobileTabs.infoInOverview}<div>{@render phoneInfo(m)}</div>{/if}')
  })
  it('names each tab by its section', () => {
    const tabs = read('./Tabs.svelte')
    expect(tabs).toContain('data-tab={labels ? tab : undefined}')
    expect(tabs).toContain('{labels?.[tab] ?? tab}')
  })
})
