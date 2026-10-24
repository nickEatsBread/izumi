import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { SETTINGS_SEARCH_INDEX } from '$lib/settings/search'
import { settingsSection, subcategoryDef } from '$lib/settings/sections'
import { renderedSettingKeys, sectionOf, subcategoriesOf } from '../../../../test/settings-sections'

const file = fileURLToPath(new URL('./+page.svelte', import.meta.url))
const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const block = (id: string) => subcategoriesOf(file).find((sub) => sub.id === id)?.source ?? ''

describe('Subtitles section', () => {
  it('is a SettingsSection page with no title of its own', () => {
    expect(sectionOf(file)).toBe('subtitles')
    expect(src).not.toContain('data-settings-page-title')
  })

  it('renders the registry subcategories in order, Advanced last and folded with a summary', () => {
    const subcategories = subcategoriesOf(file)
    expect(subcategories.map((sub) => sub.id)).toEqual(['appearance', 'styles', 'providers', 'advanced'])
    expect(subcategories.map((sub) => sub.id)).toEqual(settingsSection('subtitles').subcategories.map((sub) => sub.id))
    const advanced = subcategories.at(-1)!
    expect(advanced.summary).not.toBeUndefined()
    expect(subcategoryDef('subtitles', 'advanced')?.advanced).toBe(true)
    expect(subcategories.filter((sub) => sub.collapsible)).toEqual([])
    // Android with custom styling off would leave Advanced empty, so it is left out there.
    expect(src).toMatch(/\{#if !\$isAndroid \|\| \$subtitleStyleEnabled\}\s*<SettingsSubcategory id="advanced"/)
  })

  it('places each row in its subcategory and keeps every key', () => {
    const rows: Record<string, string[]> = {
      appearance: ['use-custom-subtitle-style', 'typeface', 'dual-subtitles'],
      providers: ['opensubtitles', 'subdl', 'jimaku'],
      advanced: [
        'subtitle-dialogue-style-overrides', 'bold-dialogue', 'font-family', 'subtitle-colours', 'subtitle-size',
        'subtitle-outline', 'subtitle-shadow', 'subtitle-position', 'automatic-sync', 'remove-sdh-annotations',
        'stronger-cleanup', 'text-filter',
      ],
    }
    const keys = renderedSettingKeys(file)
    for (const [id, ids] of Object.entries(rows)) {
      for (const key of ids) {
        expect(block(id), `${key} in ${id}`).toContain(`settingKey="${key}"`)
        expect(keys, key).toContain(key)
      }
    }
  })

  it('keeps the cleanup rows desktop-only (speech sync needs a local ffmpeg)', () => {
    expect(block('advanced')).toMatch(/\{#if !\$isAndroid\}[\s\S]*settingKey="automatic-sync"[\s\S]*settingKey="text-filter"/)
    expect(block('appearance')).toMatch(/\{#if !\$isAndroid\}\s*<SettingsRow settingKey="dual-subtitles"/)
  })

  it('imports every subtitle store from settings/ui', () => {
    for (const s of [
      'subtitleProviders',
      'openSubtitlesToken',
      'openSubtitlesExpiry',
      'openSubtitlesUserName',
      'openSubtitlesBaseUrl',
      'openSubtitlesStaySignedIn',
      'openSubtitlesCreds',
      'subDlApiKey',
      'jimakuApiKey',
    ]) {
      expect(src).toContain(s)
    }
  })

  it('renders one compact provider row and switch for each source', () => {
    expect(src).toContain("value={hasProvider('opensubtitles')}")
    expect(src).toContain("value={hasProvider('subdl')}")
    expect(src).toContain("value={hasProvider('jimaku')}")
    expect(src.match(/<SettingsSubcategory id="providers"/g)).toHaveLength(1)
    expect(src).not.toContain('Accounts & API keys')
  })

  it('separates source switches from deliberately opened credential editors', () => {
    for (const provider of ['opensubtitles', 'subdl', 'jimaku']) {
      expect(src).toContain(`expanded={expandedProvider === '${provider}'}`)
      expect(src).toContain(`onToggle={() => toggleProvider('${provider}')}`)
      expect(src).toContain(`toggleProviderDetails('${provider}')`)
    }
    expect(src.match(/<SettingsSwitch label="Enable (?:OpenSubtitles|SubDL|Jimaku)"/g)).toHaveLength(3)
    expect(src).toContain('let expandedProvider = $state<string | null>(null)')
  })

  it('offers a dialogue-only override without removing the explicit all-elements fallback', () => {
    expect(src).toContain("{ value: 'dialogue', label: 'Dialogue only' }")
    expect(src).toContain("{ value: 'all', label: 'All elements' }")
    expect(src).toContain('Preserves signs and positioned text')
  })

  it('keeps typography fine tuning as rows in the folded Advanced subcategory', () => {
    const advanced = block('advanced')
    expect(advanced).toContain('title="Bold dialogue"')
    expect(advanced).toContain('bind:value={$subtitleFont}')
    expect(advanced).toContain('bind:value={$subtitleTextColor}')
    expect(advanced).toContain('bind:value={$subtitleBorderColor}')
    for (const store of ['$subtitleFontSize', '$subtitleBorderSize', '$subtitleShadow', '$subtitlePosition']) {
      expect(advanced).toContain(`bind:value={${store}}`)
    }
    expect(src).not.toContain('fineTuningOpen')
  })

  it('prints each slider value beside its track', () => {
    expect(src.match(/<input type="range"/g)).toHaveLength(4)
    expect(src.match(/<output /g)).toHaveLength(4)
  })

  it('picks the typeface from a choice row and keeps the live preview under it', () => {
    expect(block('appearance')).toContain('settingKey="typeface"')
    expect(src).toContain('options={typefaceOptions}')
    expect(src).toContain('applyDialogueTypeface(font)')
    expect(src).toContain('style:font-family={previewTypeface}')
    expect(block('appearance')).toContain('{@render typefacePreview()}')
  })

  it('toggles custom styling from the whole row', () => {
    expect(src).toContain('onActivate={() => ($subtitleStyleEnabled = !$subtitleStyleEnabled)}')
    expect(src).toContain('pressed={$subtitleStyleEnabled}')
    expect(src).toContain('interactive={false} label="Use custom subtitle style"')
  })

  it('adds provider imagery', () => {
    expect(src).toContain('<SubtitleProviderBadge provider="opensubtitles"')
    expect(src).toContain('<SubtitleProviderBadge provider="subdl"')
    expect(src).toContain('<SubtitleProviderBadge provider="jimaku"')
  })

  it('connects via the opensubtitles_login command', () => {
    expect(src).toContain("invoke<OpenSubtitlesLogin>('opensubtitles_login'")
  })

  it('gates the connected view on token + username and keeps quota + disconnect with that provider', () => {
    expect(src).toContain('{#if $openSubtitlesToken && $openSubtitlesUserName}')
    expect(src).toContain('Disconnect')
    expect(src).toContain('remaining today')
  })

  it('has a default-off Stay signed in checkbox bound to local state', () => {
    expect(src).toContain('bind:checked={osStay}')
    expect(src).toContain('Stay signed in')
  })

  it('has a SubDL API key secret field', () => {
    expect(src).toContain('bind:value={$subDlApiKey}')
    expect(src).toContain('SubDL API key')
  })

  it('has a Jimaku API key secret field', () => {
    expect(src).toContain('bind:value={$jimakuApiKey}')
    expect(src).toContain('Jimaku API key')
  })

  it('links each provider setup to the exact account or API-key page', () => {
    for (const href of [
      'https://www.opensubtitles.com/en/users/sign_up',
      'https://subdl.com/panel/api',
      'https://jimaku.cc/account',
    ]) {
      expect(src).toContain(`href="${href}"`)
    }
    expect(src.match(/target="_blank" rel="noopener noreferrer" data-focusable/g)).toHaveLength(3)
    expect(src).toContain('Create account')
    expect(src.match(/Get API key/g)).toHaveLength(2)
  })

  it('keeps every api key field masked', () => {
    for (const store of ['$subDlApiKey', '$jimakuApiKey']) {
      const tag = (src.match(/<CredentialField[^>]*>/g) ?? []).find((t) => t.includes(`bind:value={${store}}`))
      expect(tag).toBeTruthy()
    }
  })

  it('only writes stored credentials when Stay signed in is on', () => {
    expect(src).toContain("$openSubtitlesCreds = osStay ? JSON.stringify({ username, password }) : ''")
  })

  it('marks every input as d-pad focusable', () => {
    const inputs = src.match(/<input[^>]*>/g) ?? []
    expect(inputs.length).toBeGreaterThan(0)
    for (const tag of inputs) expect(tag).toContain('data-focusable')
  })

  it('keeps row descriptions to one line and text on the rem scale', () => {
    for (const [, text] of src.matchAll(/\sdescription="([^"]*)"/g)) expect(text.length, text).toBeLessThanOrEqual(80)
    expect(src).not.toMatch(/text-\[1[01]px\]/)
  })

  it('points every Subtitles search hit at its subcategory', () => {
    const expected: Array<[string, string, string]> = [
      ['Use custom subtitle style', 'appearance', 'use-custom-subtitle-style'],
      ['Subtitle dialogue style overrides', 'advanced', 'subtitle-dialogue-style-overrides'],
      ['OpenSubtitles', 'providers', 'opensubtitles'],
      ['OpenSubtitles account', 'providers', 'opensubtitles'],
      ['Stay signed in', 'providers', 'opensubtitles'],
      ['SubDL', 'providers', 'subdl'],
      ['SubDL API key', 'providers', 'subdl'],
      ['Jimaku', 'providers', 'jimaku'],
      ['Jimaku API key', 'providers', 'jimaku'],
    ]
    for (const [title, subcategory, key] of expected) {
      const item = SETTINGS_SEARCH_INDEX.find((entry) => entry.title === title)
      expect(item, title).toMatchObject({ category: 'Subtitles', section: 'subtitles', subcategory, href: '/app/settings/subtitles', key })
      expect(item?.advanced, title).toBe(subcategory === 'advanced' ? true : undefined)
      expect(block(subcategory), title).toContain(`settingKey="${key}"`)
    }
  })
})
