import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { openingTagAt } from '../../../test/svelte-source'

// Spec §5.5 / decision 12: the small controls a thumb uses on Settings pages carry
// `data-touch-target`, which app.css turns into a 44px minimum on coarse pointers and in Game mode
// (never on TV). Rows are keyed by a label; each names a substring that sits inside exactly that
// control's opening tag (`count` when one control renders in two states from identical markup).

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

const SETTINGS = '../../../routes/app/settings/'
const SOURCES = `${SETTINGS}sources/+page.svelte`
const EXTENSIONS = `${SETTINGS}extensions/+page.svelte`
const ACCOUNTS = `${SETTINGS}accounts/+page.svelte`
const TRAKT = './TraktAccountSettings.svelte'
const LETTERBOXD = './LetterboxdAccountSettings.svelte'
const SUBTITLES = `${SETTINGS}subtitles/+page.svelte`
const NAVIGATION = `${SETTINGS}navigation/+page.svelte`
const DOWNLOADS = `${SETTINGS}downloads/+page.svelte`

interface TouchTarget { file: string; anchor: string; count?: number }

const TARGETS: Record<string, TouchTarget> = {
  'Sources: remove an add-on while its details load': { file: SOURCES, anchor: 'aria-label={`Remove ${host(url)}`}' },
  'Sources: configure an add-on': { file: SOURCES, anchor: 'onclick={() => beginConfiguration(url, m.name, m.id, configureUrl)}' },
  'Sources: remove an add-on': { file: SOURCES, anchor: 'aria-label={`Remove ${m?.name ?? host(url)}`}' },
  'Extensions: remove a source (loading and loaded)': { file: EXTENSIONS, anchor: 'onclick={() => removeExt(i)}', count: 2 },
  'Extensions: show packages or sources': { file: EXTENSIONS, anchor: 'onclick={() => toggleExpanded(url)}' },
  'Extensions: configure a package source': { file: EXTENSIONS, anchor: 'onclick={() => openJvmSourceSettings(p.sources[0].id, p.sources[0].name)}' },
  'Extensions: install, update or replace a package': { file: EXTENSIONS, anchor: 'onclick={() => installFromCatalog(url, p)}' },
  'Extensions: uninstall a package from a catalog': { file: EXTENSIONS, anchor: 'onclick={() => removePackage(url, p.id)}' },
  'Extensions: configure an installed package': { file: EXTENSIONS, anchor: 'onclick={() => openJvmSourceSettings(p.sourceId, p.name)}' },
  'Extensions: open service settings': { file: EXTENSIONS, anchor: 'onclick={() => openServiceSettings(p.id, p.name)}' },
  'Extensions: uninstall an installed package': { file: EXTENSIONS, anchor: 'onclick={() => removePackage(p.id, p.id)}' },
  'Accounts: disconnect AniList': { file: ACCOUNTS, anchor: 'onclick={disconnectAniListClick}' },
  'Accounts: connect AniList': { file: ACCOUNTS, anchor: 'onclick={connectAniListClick}' },
  'Accounts: disconnect MyAnimeList': { file: ACCOUNTS, anchor: 'onclick={disconnectMalClick}' },
  'Accounts: connect MyAnimeList': { file: ACCOUNTS, anchor: 'onclick={connectMalClick}' },
  'Accounts: disconnect Kitsu': { file: ACCOUNTS, anchor: 'onclick={disconnectKitsuClick}' },
  'Accounts: Kitsu sign in': { file: ACCOUNTS, anchor: 'onclick={() => (kitsuFormOpen = !kitsuFormOpen)}' },
  'Accounts: disconnect Simkl': { file: ACCOUNTS, anchor: 'onclick={disconnectSimklClick}' },
  'Accounts: connect Simkl': { file: ACCOUNTS, anchor: 'onclick={connectSimklClick}' },
  'Accounts: Stremio sign in or manage': { file: ACCOUNTS, anchor: 'onclick={() => (stremioFormOpen = !stremioFormOpen)}' },
  'Accounts: Stremio sync now': { file: ACCOUNTS, anchor: 'onclick={syncStremioClick}' },
  'Accounts: Stremio disconnect': { file: ACCOUNTS, anchor: 'onclick={disconnectStremioClick}' },
  'Trakt: open profile': { file: TRAKT, anchor: 'onclick={openProfile}' },
  'Trakt: open the Trakt hub': { file: TRAKT, anchor: 'href="/app/trakt"' },
  'Trakt: disconnect': { file: TRAKT, anchor: 'onclick={disconnect}' },
  'Trakt: app settings': { file: TRAKT, anchor: "onclick={() => openUrl('https://app.trakt.tv/settings/apps')}" },
  'Trakt: cancel': { file: TRAKT, anchor: 'onclick={cancel}' },
  'Trakt: connect': { file: TRAKT, anchor: 'onclick={connect}' },
  'Letterboxd: set up or manage': { file: LETTERBOXD, anchor: 'onclick={() => (formOpen = !formOpen)}' },
  'Letterboxd: save': { file: LETTERBOXD, anchor: 'onclick={save}' },
  'Letterboxd: clear': { file: LETTERBOXD, anchor: 'onclick={clear}' },
  'Letterboxd: export data': { file: LETTERBOXD, anchor: "onclick={() => openUrl('https://letterboxd.com/user/exportdata/')}" },
  'Letterboxd: open the hub': { file: LETTERBOXD, anchor: 'href="/app/letterboxd"' },
  'Subtitles: apply a saved style': { file: SUBTITLES, anchor: 'onclick={() => applyPreset(preset)}' },
  'Subtitles: rename a saved style': { file: SUBTITLES, anchor: 'onclick={() => startRename(preset)}' },
  'Subtitles: delete a saved style': { file: SUBTITLES, anchor: 'onclick={() => deleteSubtitlePreset(preset.id)}' },
  'Scenes: clear all': { file: `${SETTINGS}scenes/+page.svelte`, anchor: 'onclick={clearAll}' },
  'Scenes: remove a bookmark': { file: `${SETTINGS}scenes/+page.svelte`, anchor: 'onclick={() => removeSceneBookmark(scene.id)}' },
  'History: clear all': { file: `${SETTINGS}history/+page.svelte`, anchor: 'onclick={doClear}' },
  'History: forget a title': { file: `${SETTINGS}history/+page.svelte`, anchor: 'onclick={() => forgetMedia(e.media.id)}' },
  'Collections: remove a collection': {
    file: `${SETTINGS}catalog/collections/+page.svelte`,
    anchor: 'onclick={() => homeCollections.update((collections) => collections.filter((item) => item.id !== collection.id))}',
  },
  'Customize Home: delete a custom row': { file: `${SETTINGS}catalog/home/+page.svelte`, anchor: 'onclick={() => deleteCustomTmdbRow(row.id)}' },
  'Downloads: auto-download Enabled label': { file: DOWNLOADS, anchor: 'class="inline-flex items-center gap-1 py-2 text-xs font-bold sm:py-0"' },
  'Downloads: remove an auto-download rule': { file: DOWNLOADS, anchor: 'onclick={() => removeAutoDownloadRule(rule.id)}' },
  'Navigation: placement buttons': { file: NAVIGATION, anchor: 'onclick={() => setPlacement(it.id, p.value)}' },
  'Navigation: move up': { file: NAVIGATION, anchor: 'onclick={() => move(i, -1)}' },
  'Navigation: move down': { file: NAVIGATION, anchor: 'onclick={() => move(i, 1)}' },
  'SelectMenu: trigger': { file: './SelectMenu.svelte', anchor: 'bind:this={trigger}' },
}

function occurrences(source: string, needle: string): number[] {
  const found: number[] = []
  for (let at = source.indexOf(needle); at !== -1; at = source.indexOf(needle, at + needle.length)) found.push(at)
  return found
}

const FILES = [...new Set(Object.values(TARGETS).map((target) => target.file))]

describe('settings touch targets', () => {
  it.each(Object.entries(TARGETS))('%s carries data-touch-target', (_label, { file, anchor, count = 1 }) => {
    const source = read(file)
    const found = occurrences(source, anchor)
    expect(found, `${anchor} in ${file}`).toHaveLength(count)
    for (const at of found) expect(openingTagAt(source, at)).toMatch(/\sdata-touch-target[\s>]/)
  })

  it('never marks a switch track, a checkbox or a radio, whose box a minimum size would distort', () => {
    for (const file of FILES) {
      const source = read(file)
      for (const at of occurrences(source, 'data-touch-target')) {
        const tag = openingTagAt(source, at)
        expect(tag, `${file}: ${tag}`).not.toMatch(/\sdata-switch[\s>]|type="(?:checkbox|radio)"/)
      }
    }
  })

  it('marks the controls listed above and nothing else in these files', () => {
    const expected = Object.values(TARGETS).reduce((sum, target) => sum + (target.count ?? 1), 0)
    const marked = FILES.reduce((sum, file) => sum + occurrences(read(file), 'data-touch-target').length, 0)
    expect(marked).toBe(expected)
  })
})
