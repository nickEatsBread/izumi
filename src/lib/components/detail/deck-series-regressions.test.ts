import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('Steam Deck series interactions', () => {
  it('opens Browse with the selected series season and year', () => {
    const detail = read('./AnimeDetail.svelte')
    expect(detail).toContain("import { title, cover, format, status, season, seasonBrowseHref")
    expect(detail.match(/href=\{seasonBrowseHref\(m\)\}/g)?.length).toBe(2)
    // The phone Information grid's season fact links to the same place (facts.ts).
    expect(read('../../detail/facts.ts')).toContain('if (fact.value) fact.href = seasonBrowseHref(m)')
  })

  it('releases pointer focus from a tapped tab without releasing controller focus', () => {
    const tabs = read('./Tabs.svelte')
    expect(tabs).toContain('$gameMode && event.detail > 0')
    expect(tabs).toContain('requestAnimationFrame(() => button.blur())')
  })

  it('hides the native number stepper behind the large episode buttons', () => {
    const editor = read('./ListEditor.svelte')
    expect(editor).toContain('class="progress-input')
    expect(editor).toContain('.progress-input::-webkit-inner-spin-button')
    expect(editor).toContain('-webkit-appearance: none')
  })

  it('copies Share text without treating the temporary textarea as keyboard input', () => {
    const clipboard = read('../../util/clipboard.ts')
    const keyboard = read('../../nav/osk.ts')
    const textField = read('../../nav/text-field.ts')
    expect(clipboard).toContain("ta.dataset.clipboardProxy = 'true'")
    expect(clipboard).toContain('focused.focus({ preventScroll: true })')
    expect(keyboard).toContain("import { isTextEntryField, type TextEntryField } from './text-field'")
    expect(textField).toContain('clipboardProxy')
  })
})
