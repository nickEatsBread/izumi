import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETTINGS_SEARCH_INDEX, searchSettings, type SettingsSearchEnv } from './search'
import { controllerHides } from './surface'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const entry = (key: string, title: string) =>
  SETTINGS_SEARCH_INDEX.find((item) => item.key === key) ?? SETTINGS_SEARCH_INDEX.find((item) => item.title === title)

describe('rows hidden in controller mode (spec §5.6)', () => {
  it.each([
    ['hotkeys', 'Hotkeys', ['gamemode']],
    ['wheel-scroll-carousels', 'Wheel-scroll carousels', ['tv', 'gamemode']],
    ['mouse-drag-carousels', 'Mouse-drag carousels', ['tv', 'gamemode']],
    ['schedule-layout', 'Schedule layout', ['tv', 'gamemode']],
    ['haptics', 'Haptics', ['tv']],
    ['miniplayer-when-you-leave-the-app', 'Miniplayer when you leave the app', ['tv']],
  ] as const)('%s has its key and hides on %j', (key, title, tags) => {
    const item = entry(key, title)
    expect(item?.key).toBe(key)
    for (const tag of tags) expect(item?.hideOn).toContain(tag)
  })

  it('hides those rows exactly where their search hits go', () => {
    expect(controllerHides('wheel-scroll-carousels', { tv: true, gamemode: false })).toBe(true)
    expect(controllerHides('mouse-drag-carousels', { tv: false, gamemode: true })).toBe(true)
    expect(controllerHides('haptics', { tv: false, gamemode: true })).toBe(false)
    expect(controllerHides('haptics', { tv: true, gamemode: false })).toBe(true)
    const keys = (env: SettingsSearchEnv) => searchSettings('carousels', env).map((item) => item.key)
    expect(keys({ android: false })).toEqual(expect.arrayContaining(['wheel-scroll-carousels', 'mouse-drag-carousels']))
    expect(keys({ android: false, gamemode: true })).not.toContain('wheel-scroll-carousels')
    expect(keys({ android: false, gamemode: true })).not.toContain('mouse-drag-carousels')
    expect(searchSettings('hotkeys', { android: false, gamemode: true }).map((item) => item.key)).not.toContain('hotkeys')
  })

  it('SettingsSearch passes Game mode and SettingsRow renders nothing for a hidden row', () => {
    const search = read('../components/settings/SettingsSearch.svelte')
    const row = read('../components/settings/SettingsRow.svelte')
    expect(search).toContain('lite: !$inAppPlayerAvailable, gamemode: $gameMode')
    expect(row).toContain("import { controllerHides, controllerSurfaces } from '$lib/settings/surface'")
    expect(row).toContain('const shown = $derived(!controllerHides(settingKey, $controllerSurfaces))')
    expect(row).toContain('{#if shown}')
    expect(row.trimEnd().endsWith('{/if}')).toBe(true)
  })
})
