import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const source = readFileSync(new URL('./CredentialField.svelte', import.meta.url), 'utf8')
describe('credential editor', () => {
  it('keeps stored credentials out of the collapsed summary and masks edits', () => {
    expect(source).toContain("let editing = $state(false)")
    expect(source).toContain("type={revealed ? 'text' : 'password'}")
    expect(source).toContain('Credential saved · hidden')
    expect(source).not.toContain('{value}</')
  })
  it('uses an explicit draft, save, cancel and confirmed removal', () => {
    expect(source).toContain('bind:value={draft}')
    expect(source).toContain('value = draft.trim()')
    expect(source).toContain('onclick={cancel}')
    expect(source).toContain('if (!confirmRemove)')
    expect(source).toContain('Not yet verified with the service')
  })
  it('offers typing here or sending from a phone in controller mode (spec §5.4)', () => {
    expect(source).toContain("import { settingsControllerMode } from '$lib/settings/surface'")
    expect(source).toContain("{$settingsControllerMode ? ($isTv ? 'Enter on this TV' : 'Enter on this device') : value ? 'Edit' : 'Set up'}")
    expect(source).toContain("const SEND_FROM_PHONE_HREF = '/app/settings/devices?setting=settings-and-sources-sync'")
    expect(source).toContain('{#if $settingsControllerMode && sendFromPhone}<a href={SEND_FROM_PHONE_HREF}')
    expect(source).toContain('>Send from phone</a>')
    expect(source.match(/Send from phone/g)).toHaveLength(1)
  })
  it('names each controller choice after its credential', () => {
    expect(source).toContain("aria-label={$settingsControllerMode ? `Enter ${label} on this ${$isTv ? 'TV' : 'device'}` : undefined}")
    expect(source).toContain('aria-label={`Send ${label} from phone`}')
  })
  it('keeps startOpen rows closed in controller mode so the choices show', () => {
    expect(source).toContain('if (startOpen && !value && !get(settingsControllerMode)) edit()')
  })
  it('offers Send from phone only on the debrid key, the one credential the device transfer carries', () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
    expect(read('./TorrentDebridSettings.svelte')).toMatch(/<CredentialField bind:value=\{\$debridKey\}[^>]*\bsendFromPhone\b/)
    for (const page of ['../../../routes/app/settings/library/+page.svelte', '../../../routes/app/settings/subtitles/+page.svelte']) {
      const tags = read(page).match(/<CredentialField[^>]*>/g) ?? []
      expect(tags.length).toBe(2)
      for (const tag of tags) expect(tag).not.toContain('sendFromPhone')
    }
  })
})
