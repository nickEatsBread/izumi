import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./EpisodeList.svelte', import.meta.url)), 'utf8')

describe('mobile download select mode', () => {
  it('renders its own panel instead of the desktop chip row', () => {
    // The desktop toolbar is `grid grid-cols-2 … sm:flex sm:flex-wrap`; feeding select mode's
    // mismatched-height chips through it is what produced the scattered mobile layout.
    expect(source).toContain('{#if selecting && $isMobile}')
    expect(source).toContain('mb-4 rounded-xl border border-border bg-card p-3')
  })

  it('gives every select-mode control a full-width touch target', () => {
    expect(source).toContain('mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-secondary')
    expect(source).toContain('mt-2 flex min-h-12 cursor-pointer items-center gap-3 rounded-lg bg-secondary')
  })

  it('pins the download action above Android system UI and the bottom tab bar', () => {
    expect(source).toContain('fixed inset-x-0 bottom-0 z-40')
    expect(source).toContain('max(0.75rem, env(safe-area-inset-bottom))')
    // Spacer so the last episode row / pager are not trapped under the fixed bar.
    expect(source).toContain('<div class="h-28" aria-hidden="true"></div>')
  })

  it('states the matching rules rather than linking to them blind', () => {
    expect(source).toContain('const matchSummary = $derived(')
    expect(source).not.toContain('>Matching settings<')
  })
})
