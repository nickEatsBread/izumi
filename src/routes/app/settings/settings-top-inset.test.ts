import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The status-bar inset used to be applied twice on a settings sub-page: once by `main` (app.css)
// and again by this layout's sticky header. That produced a permanently black band above the
// header that no screen could paint into, and cost ~2x the status-bar height on every sub-page.

const css = readFileSync(fileURLToPath(new URL('../../../app.css', import.meta.url)), 'utf8')
const layout = readFileSync(fileURLToPath(new URL('./+layout.svelte', import.meta.url)), 'utf8')

describe('settings sub-page top inset', () => {
  it('insets main through an overridable variable', () => {
    expect(css).toContain('main { padding-top: var(--main-safe-top, env(safe-area-inset-top)); }')
    expect(css).toContain('.edge-to-edge main { --main-safe-top: 0px; }')
  })

  it('lets the sticky header own the inset, since main cannot protect a stuck element', () => {
    expect(layout).toContain('style="padding-top:max(0.5rem,env(safe-area-inset-top))"')
  })

  it('opts the settings screen out of the main inset so it is not applied twice', () => {
    expect(layout).toContain("document.documentElement.classList.add('edge-to-edge')")
    expect(layout).toContain("document.documentElement.classList.remove('edge-to-edge')")
  })
})
