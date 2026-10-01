import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

// The in-page targets of the layered Back (nav/back.ts steps 5, 7, 8) and the Profiles exit.
describe('layered Back markers on Settings pages', () => {
  it('Themes detail: B clicks "Back to themes", and still consumes B while it is busy', () => {
    const themes = read('./themes/+page.svelte')
    expect(themes).toContain('<section class="theme-detail" aria-busy={busy} data-nav-back-scope>')
    expect(themes).toContain('<button class="back" data-focusable data-nav-back disabled={busy}')
  })

  it('Theme Studio: B minimizes, or keeps editing while the close prompt is open', () => {
    const studio = read('../../../lib/components/settings/ThemeStudio.svelte')
    expect(studio).toContain('aria-labelledby="studio-heading" data-nav-back-scope')
    expect(studio).toContain(`onclick={minimize} aria-label="Minimize Theme Studio" data-nav-back={confirmClose ? undefined : ''}`)
    expect(studio).toContain('class="keep-editing" data-nav-back>Keep editing</button>')
    expect(studio.match(/data-nav-back(?=[=>\s])/g)).toHaveLength(2)
  })

  it('Hotkeys: B while recording cancels the recording instead of leaving', () => {
    const hotkeys = read('./hotkeys/+page.svelte')
    expect(hotkeys).toContain("data-nav-escape-local={recording === hotkey.id ? '' : undefined}")
    expect(hotkeys).toContain("if (event.key === 'Escape') {\n      recording = null")
  })

  it('Profiles leaves the way it was entered, from Back on the overview and from Done', () => {
    const profiles = read('./profiles/+page.svelte')
    expect(profiles).toContain("import { previousPath } from '$lib/navigation/history-trail'")
    expect(profiles).toContain("import { markBackPending } from '$lib/nav/nav-state'")
    expect(profiles).toContain([
      '  function leave() {',
      '    const from = previousPath()',
      '    markBackPending()',
      "    if (from !== null && !from.startsWith('/app/settings/profiles')) history.back()",
      "    else void goto('/app/settings', { replaceState: true })",
      '  }',
    ].join('\n'))
    expect(profiles).toContain('    else leave()\n  }')
    expect(profiles).toContain('class="primary" onclick={leave}>Done</button>')
    expect(profiles).not.toContain("goto('/app/home')")
    expect(profiles).not.toContain("goto('/app/settings/accounts')")
  })

  it('a locked profile switcher marks itself, so B offers the exit prompt (commit 3)', () => {
    expect(read('../../../lib/components/profiles/ProfileSwitcher.svelte')).toContain('data-nav-back-exit=')
  })
})
