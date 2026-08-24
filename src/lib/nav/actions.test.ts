import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./actions.ts', import.meta.url)), 'utf8')

describe('Game-mode native tooltip suppression', () => {
  it('strips existing and dynamically-added title attributes before hover', () => {
    expect(source).toContain('stripTree(document)')
    expect(source).toContain("attributeFilter: ['title']")
    expect(source).toContain("root.querySelectorAll?.('[title]')")
  })

  it('keeps tooltip text available to accessibility APIs', () => {
    expect(source).toContain("el.setAttribute('data-title', title)")
    expect(source).toContain("el.setAttribute('aria-label', title)")
  })
})
