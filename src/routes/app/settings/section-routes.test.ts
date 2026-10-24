import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importClosure } from '../../../test/svelte-markup'
import { LEGACY_SETTINGS_ROUTES, SETTINGS_SECTIONS } from '$lib/settings/sections'

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const read = (relative: string) => readFileSync(file(relative), 'utf8').replace(/\r\n/g, '\n')

describe('settings section routes', () => {
  it.each(SETTINGS_SECTIONS.map((section) => section.id))('%s renders its SettingsSection', (id) => {
    const page = read(`./${id}/+page.svelte`)
    expect(page).toContain("import SettingsSection from '$lib/components/settings/SettingsSection.svelte'")
    expect(page).toContain(`<SettingsSection section="${id}">`)
    expect(page).toContain('</SettingsSection>')
  })

  it('renders Playback at the bare /app/settings on desktop', () => {
    const root = read('./+page.svelte')
    expect(root).toContain("import Playback from './playback/+page.svelte'")
    expect(root).toContain('{#if !$isMobile}\n  <Playback />\n{/if}')
  })

  it('keeps every old page that still exists reachable from a section page (rendered inside or linked)', () => {
    const sections = SETTINGS_SECTIONS.map((section) => file(`./${section.id}/+page.svelte`))
    const reachable = importClosure(sections).map((path) => readFileSync(path, 'utf8')).join('\n')
    // Old pages whose every row now lives in a section page: they only wait for deletion. Extensions
    // survives only as the source list the Manage sources sub-page mounts; its own route redirects.
    const migrated = new Set(['player', 'hotkeys', 'extensions'])
    for (const old of LEGACY_SETTINGS_ROUTES.keys()) {
      if (migrated.has(old) || !existsSync(file(`./${old}/+page.svelte`))) continue
      expect(reachable.includes(`'../${old}/+page.svelte'`) || reachable.includes(`/app/settings/${old}`), old).toBe(true)
    }
  })

  it('mounts the old Hotkeys page off Android only (it sends Android back to /app/settings)', () => {
    const playback = read('./playback/+page.svelte')
    if (!playback.includes("'../hotkeys/+page.svelte'")) return
    expect(playback).toMatch(/\{#if !\$isAndroid\}\s*<SettingsSubcategory id="controls"[^>]*><HotkeysPage \/>/)
  })
})
