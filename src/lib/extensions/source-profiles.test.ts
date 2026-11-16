import { describe, expect, it } from 'vitest'
import type { ServiceSettingsDocument } from './manager'
import { profileChoice, sourceProfiles } from './source-profiles'

const doc = (options: Array<{ value: string; label: string; image?: string }>, current = 'b'): ServiceSettingsDocument => ({
  version: 1,
  fields: [
    { key: 'accountAction', label: 'Account action', type: 'select', role: 'action', options: [] },
    { key: 'profileId', label: 'Profile', type: 'select', role: 'profile', visibleWhen: { key: 'accountAction', equals: 'profile' }, options },
  ],
  values: { profileId: current },
})

describe("a source's own profiles", () => {
  it('lists the profile field\'s options, marking the current one', () => {
    const found = sourceProfiles(doc([{ value: 'a', label: 'Ann', image: 'https://img.example/a.png' }, { value: 'b', label: 'Bo' }]))
    expect(found?.profiles).toEqual([
      { id: 'a', name: 'Ann', image: 'https://img.example/a.png', current: false },
      { id: 'b', name: 'Bo', current: true },
    ])
  })

  it('offers nothing for a single profile or no profile field', () => {
    expect(sourceProfiles(doc([{ value: 'a', label: 'Ann' }]))).toBeUndefined()
    expect(sourceProfiles({ version: 1, fields: [], values: {} })).toBeUndefined()
  })

  it('saves the choice with the value that shows the picker in the settings sheet', () => {
    const field = doc([])!.fields[1]
    expect(profileChoice(field, 'a')).toEqual({ accountAction: 'profile', profileId: 'a' })
    expect(profileChoice({ ...field, visibleWhen: undefined }, 'a')).toEqual({ profileId: 'a' })
  })
})

describe('when izumi asks', () => {
  it("asks once a session on a source's screen, after the startup video, and from the drawer", async () => {
    const { readFileSync } = await import('node:fs')
    const home = readFileSync('src/lib/components/catalog/CatalogHome.svelte', 'utf8')
    expect(home).toContain("if (!isSourceSelection(selection) || $startupAnimationPlaying) return")
    expect(home).toContain('const asked = `source-profiles-asked:${selection}`')
    expect(home).toContain("if (live && sourceProfiles(document)) void goto('/app/source-profiles')")
    expect(readFileSync('src/lib/components/shell/Sidebar.svelte', 'utf8')).toContain("...(manyProfiles ? [{ id: 'profiles', href: '/app/source-profiles'")
  })
})
