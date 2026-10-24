import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('TV surface wiring (API 6)', () => {
  const runtime = read('./runtime.ts')
  const theme = read('../theme.ts')

  it('derives the TV surface from Android TV or Game mode and resolves the TV block there', () => {
    expect(runtime).toContain("export const tvSurface = derived([isTv, gameMode], ([tv, gm]) => tv || gm)")
    expect(runtime).toContain('resolvePresentation(layout, mobile, tv)')
    expect(runtime).toContain('shellNavFor(mobile, tv, layout, presentation)')
  })

  it('publishes data-surface on the document only while a theme is active on a TV surface', () => {
    expect(theme).toContain("root.dataset.surface = 'tv'")
    expect(theme).toContain('delete root.dataset.surface')
    expect(theme).toContain('resolvePresentation(studio.presentation, get(isMobile), get(tvSurface))')
    expect(theme).toMatch(/activeStudioTheme, themeStudioPreview, isMobile, tvSurface,/)
  })
})
