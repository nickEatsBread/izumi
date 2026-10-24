import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('a theme TV top bar on Android TV (API 6)', () => {
  const css = read('../../../app.css')
  const sidebar = read('./Sidebar.svelte')
  const theme = read('../../theme.ts')

  it('keeps the TV rail sizing to the side rail and the page margin to rail layouts', () => {
    expect(css).toContain(".tv-mode [data-slot='nav.side'] { width: 4rem !important; }")
    expect(css).toContain(".tv-mode [data-slot='nav.side']:focus-within { width: 14rem !important; }")
    expect(css).toContain(".tv-mode:not([data-theme-nav='top']) main { margin-left: 4rem !important; }")
    expect(css).not.toContain('.tv-mode [data-nav-sidebar] { width')
  })

  it('drops the titlebar band from a TV top bar as Game mode does', () => {
    expect(css).toContain("html.tv-mode[data-theme-nav='top'] { --theme-shell-top: var(--theme-top-row); }")
    expect(css).toContain("html.tv-mode[data-theme-nav='top'] [data-slot='page'] { padding-top: var(--theme-top-row); }")
    expect(sidebar).toContain("{top && ($gameMode || $isTv) ? '!h-[var(--theme-top-row)] !pt-0' : ''}")
  })

  it('names the placement the TV actually renders on the document', () => {
    expect(theme).toContain("root.dataset.themeNav = get(isTv) ? get(shellNav) : presentation?.shell?.nav ?? 'sidebar'")
  })
})
