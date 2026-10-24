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
    expect(source).toContain("const SEND_FROM_PHONE_HREF = '/app/settings/devices'")
    expect(source).toContain('>Send from phone</a>')
  })
})
