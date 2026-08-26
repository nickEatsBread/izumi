import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('Subtitles settings page', () => {
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
    expect(src.match(/<SettingsGroup icon=\{Languages\}/g)).toHaveLength(1)
    expect(src).not.toContain('Accounts & API keys')
  })

  it('toggles and expands providers from the whole pulsing row', () => {
    for (const provider of ['opensubtitles', 'subdl', 'jimaku']) {
      expect(src).toContain(`expanded={hasProvider('${provider}')}`)
      expect(src).toContain(`onActivate={() => toggleProvider('${provider}')}`)
      expect(src).toContain(`pressed={hasProvider('${provider}')}`)
    }
    expect(src.match(/interactive=\{false\} label="Enable (?:OpenSubtitles|SubDL|Jimaku)"/g)).toHaveLength(3)
    expect(src).not.toContain('expandedProvider')
    expect(src).not.toContain('toggleProviderDetails')
  })

  it('places providers before appearance', () => {
    expect(src.indexOf('title="Providers"')).toBeLessThan(src.indexOf('title="Appearance"'))
  })

  it('offers a dialogue-only override without removing the explicit all-elements fallback', () => {
    expect(src).toContain("{ value: 'dialogue', label: 'Dialogue only' }")
    expect(src).toContain("{ value: 'all', label: 'All elements' }")
    expect(src).toContain('Preserves signs and positioned text')
  })

  it('keeps detailed typography controls collapsed under fine tuning', () => {
    expect(src).toContain('expanded={fineTuningOpen}')
    expect(src).toContain('onActivate={() => (fineTuningOpen = !fineTuningOpen)}')
    expect(src).toContain('Fine tuning')
    expect(src).toContain('Bold dialogue')
  })

  it('stacks the wide scope menu at full width on mobile', () => {
    expect(src).toContain('className="w-full sm:w-36"')
    expect(src.match(/controlLayout="stack"/g)).toHaveLength(1)
  })

  it('previews typefaces on hover and focus while making the whole option selectable', () => {
    expect(src).toContain('hoveredTypeface = typeface.font')
    expect(src).toContain('onfocus={() => (hoveredTypeface = typeface.font)}')
    expect(src).toContain('onclick={() => applyDialogueTypeface(typeface.font)}')
    expect(src).toContain('aria-pressed={selected}')
    expect(src).toContain('style:font-family={previewTypeface}')
    expect(src).toContain('sm:grid-cols-3')
    expect(src).toContain('use:ripple')
  })

  it('uses the unused desktop column for the preview with a mobile fallback', () => {
    expect(src).toContain('lg:grid-cols-[minmax(0,42rem)_minmax(18rem,1fr)]')
    expect(src).toContain('aria-label="Typeface preview"')
    expect(src).toContain('sticky top-8 hidden min-w-0 lg:block')
    expect(src).toContain('mt-3 lg:hidden')
  })

  it('toggles custom styling from the whole pulsing row', () => {
    expect(src).toContain('onActivate={() => ($subtitleStyleEnabled = !$subtitleStyleEnabled)}')
    expect(src).toContain('pressed={$subtitleStyleEnabled}')
    expect(src).toContain('interactive={false} label="Use custom subtitle style"')
  })

  it('adds meaningful section and provider imagery', () => {
    expect(src).toContain('<SettingsGroup')
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
      const tag = (src.match(/<input[^>]*>/g) ?? []).find((t) => t.includes(`bind:value={${store}}`))
      expect(tag).toContain('type="password"')
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
})
