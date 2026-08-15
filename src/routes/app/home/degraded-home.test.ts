import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('degraded home', () => {
  it('never replaces personal/local rows with the old full-page AniList error', () => {
    expect(page).not.toContain("<h2 class=\"mb-2 text-lg font-black\">Couldn't reach AniList</h2>")
    expect(page).not.toContain('onclick={retry}')
    expect(page).toContain('<ContinueRow title="Continue Watching"')
  })

  it('stops the hero skeleton when both catalog providers have failed', () => {
    expect(page).toContain('const catalogUnavailable = $derived(!!$anilistDegraded?.fallbackError)')
    expect(page).toContain('{:else if !catalogUnavailable && hero.fetching}')
    expect(page).toContain('{#if section && !catalogUnavailable}<HomeRow')
  })

  it('keeps the Android toolbar below the fixed degraded banner', () => {
    expect(page).toContain("{$anilistDegraded ? 'mt-7' : ''}")
  })

  it('keeps the first personal row below the desktop banner when the hero is removed', () => {
    expect(page).toContain('const homeNeedsAlertInset = $derived(!!$anilistDegraded && heroMedias.length === 0)')
    expect(page).toContain("homeNeedsAlertInset ? 'sm:pt-[3.75rem]' : ''")
  })
})
