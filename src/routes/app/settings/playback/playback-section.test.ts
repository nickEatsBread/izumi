import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETTINGS_SEARCH_INDEX } from '$lib/settings/search'
import { settingsSection, subcategoryDef } from '$lib/settings/sections'
import { renderedSettingKeys, sectionOf, subcategoriesOf } from '../../../../test/settings-sections'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const read = (relative: string) => readFileSync(here(relative), 'utf8').replace(/\r\n/g, '\n')
const file = here('./+page.svelte')
const page = read('./+page.svelte')

/** Where each row lives (spec §3.1). `hotkeys` is rendered by HotkeyBindings inside Controls. */
const ROWS: Record<string, string[]> = {
  'up-next': ['auto-play-next-episode', 'show-up-next-countdown', 'binge-next-episode-preload', 'ask-for-a-rating-when-a-series-ends'],
  skipping: ['auto-skip-openings-endings', 'auto-skip-next-episode-previews', 'skip-filler-episodes'],
  seeking: ['seek-duration', 'scrub-preview-thumbnails'],
  'player-window': [
    'miniplayer-when-you-leave-the-app', 'keep-screen-awake-while-playing', 'system-media-controls',
    'discord-rich-presence', 'hide-sidebar-while-playing', 'p2p-playback-status', 'gif-recorder',
    'include-subtitles-in-gifs', 'gif-width', 'gif-max-length',
  ],
  quality: ['auto-play-the-best-source', 'preferred-quality', 'continue-watching-source'],
  controls: [],
  advanced: [
    'rendering-preset', 'custom-mpv-options', 'windows-driver-upscaling', 'player-cache-size', 'player-cache-custom',
    'audio-processing', 'home-theatre-audio', 'audio-output', 'dolby-digital', 'dolby-digital-plus', 'dolby-truehd',
    'dts', 'dts-hd-dts-x', 'exclusive-audio-device', 'mpv-audio-device', 'dolby-vision-source-handling',
    'enable-external-player', 'external-video-player', 'animate-player-progress-controls', 'subtitle-line-navigation',
    'title-at-top-of-player-game-mode', 'adaptive-source-planner', 'mark-best-releases',
  ],
}

/** Search hits for Playback rows: title → [subcategory, advanced]. */
const SEARCH: Array<[string, string, boolean]> = [
  ['Auto-play next episode', 'up-next', false],
  ['Show Up Next countdown', 'up-next', false],
  ['Binge next episode (preload)', 'up-next', false],
  ['Ask for a rating when a series ends', 'up-next', false],
  ['Auto-skip openings & endings', 'skipping', false],
  ['Auto-skip next-episode previews', 'skipping', false],
  ['Skip filler episodes', 'skipping', false],
  ['Seek duration', 'seeking', false],
  ['Scrub preview thumbnails', 'seeking', false],
  ['Miniplayer when you leave the app', 'player-window', false],
  ['Keep screen awake while playing', 'player-window', false],
  ['Discord Rich Presence', 'player-window', false],
  ['Hide sidebar while playing', 'player-window', false],
  ['P2P playback status', 'player-window', false],
  ['GIF recorder', 'player-window', false],
  ['Include subtitles in GIFs', 'player-window', false],
  ['Auto-play the best source', 'quality', false],
  ['Preferred quality', 'quality', false],
  ['Hotkeys', 'controls', false],
  ['Rendering preset', 'advanced', true],
  ['Player cache size', 'advanced', true],
  ['Audio processing', 'advanced', true],
  ['Home-theatre audio', 'advanced', true],
  ['Dolby Vision source handling', 'advanced', true],
  ['Enable external player', 'advanced', true],
  ['Animate player progress controls', 'advanced', true],
  ['Subtitle line navigation', 'advanced', true],
  ['Title at top of player (Game mode)', 'advanced', true],
  ['Adaptive source planner', 'advanced', true],
  ['Mark best releases', 'advanced', true],
]

describe('Playback section', () => {
  it('is a SettingsSection page with no title of its own', () => {
    expect(sectionOf(file)).toBe('playback')
    expect(page).not.toContain('data-settings-page-title')
  })

  it('renders the registry subcategories in order', () => {
    const ids = subcategoriesOf(file).map((sub) => sub.id)
    expect(ids).toEqual(['up-next', 'skipping', 'seeking', 'player-window', 'quality', 'controls', 'advanced'])
    expect(ids).toEqual(settingsSection('playback').subcategories.map((sub) => sub.id))
  })

  it('folds Advanced last with its summary, and folds nothing else', () => {
    const subcategories = subcategoriesOf(file)
    expect(subcategories.at(-1)).toMatchObject({ id: 'advanced', summary: 'Rendering preset, audio output, Dolby Vision and more' })
    // No `collapsible` prop anywhere: Advanced folds because the registry marks it, the rest stay open.
    expect(subcategoryDef('playback', 'advanced')?.advanced).toBe(true)
    expect(subcategories.filter((sub) => sub.collapsible)).toEqual([])
  })

  it('gates whole subcategories the way their rows are gated', () => {
    for (const id of ['skipping', 'seeking', 'player-window']) {
      expect(page).toMatch(new RegExp(`\\{#if \\$inAppPlayerAvailable\\}\\s*<SettingsSubcategory id="${id}"`))
    }
    expect(page).toMatch(/\{#if !\$isAndroid\}\s*<SettingsSubcategory id="controls" plain>\s*<HotkeyBindings \/>/)
    expect(read('../../../../lib/components/settings/HotkeyBindings.svelte')).toContain('<div data-setting-key="hotkeys">')
  })

  it('puts every moved row in its subcategory and still renders every key', () => {
    const blocks = new Map(subcategoriesOf(file).map((sub) => [sub.id, sub.source]))
    for (const [id, keys] of Object.entries(ROWS)) {
      for (const key of keys) expect(blocks.get(id), `${key} in ${id}`).toContain(`="${key}"`)
    }
    const rendered = renderedSettingKeys(file)
    for (const key of [...Object.values(ROWS).flat(), 'hotkeys']) expect(rendered, key).toContain(key)
  })

  it('keeps row descriptions to one line and text on the rem scale', () => {
    for (const [, text] of page.matchAll(/\sdescription="([^"]*)"/g)) expect(text.length, text).toBeLessThanOrEqual(80)
    expect(page).not.toMatch(/text-\[1[01]px\]/)
  })

  it('points every Playback search hit at the subcategory that renders its row', () => {
    const blocks = new Map(subcategoriesOf(file).map((sub) => [sub.id, sub.source]))
    for (const [title, subcategory, advanced] of SEARCH) {
      const item = SETTINGS_SEARCH_INDEX.find((entry) => entry.title === title)
      expect(item, title).toMatchObject({ category: 'Playback', section: 'playback', subcategory, href: '/app/settings/playback' })
      expect(item?.advanced, title).toBe(advanced ? true : undefined)
      expect(item?.key, title).toBeTruthy()
      if (subcategory !== 'controls') expect(blocks.get(subcategory), title).toContain(`="${item?.key}"`)
    }
    expect(SETTINGS_SEARCH_INDEX.map((entry) => entry.title)).not.toContain('Video quality')
  })

  it('leaves no copy of a moved row on the Sources page', () => {
    const sources = read('../sources/+page.svelte')
    for (const gone of ['automatic-selection-heading', '$autoSelectSource', '$preferredQuality', '$adaptiveSourceMode', '$seadexAnnotations']) {
      expect(sources).not.toContain(gone)
    }
  })
})
