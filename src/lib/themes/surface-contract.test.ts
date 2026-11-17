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
    expect(runtime).toContain('shellNavFor(mobile, tv, layout, presentation, gm)')
  })

  it('publishes data-surface on the document only while a theme is active on a TV surface', () => {
    expect(theme).toContain("root.dataset.surface = 'tv'")
    expect(theme).toContain('delete root.dataset.surface')
    // Document chrome reads the same resolved presentation as the components (runtime.ts).
    expect(theme).toContain('const presentation = get(themePresentation)')
    expect(theme).toMatch(/shownStudioTheme, themeStudioPreview, isMobile, tvSurface,/)
  })
})
