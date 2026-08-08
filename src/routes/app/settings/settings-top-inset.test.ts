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

  it('does not re-apply the inset inside the settings header', () => {
    expect(layout).not.toContain('env(safe-area-inset-top)')
  })
})
