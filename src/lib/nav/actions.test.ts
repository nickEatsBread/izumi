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

describe('Game-mode carousel touch arbitration', () => {
  it('gives vertical gestures to the document and owns only clear horizontal intent', () => {
    expect(source).toContain('export function gameModeCarouselTouch')
    expect(source).toContain("node.style.touchAction = enabled ? 'pan-y'")
    expect(source).toContain("Math.abs(dx) > Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical'")
    expect(source).toContain("if (axis !== 'horizontal') return")
    expect(source).toContain('event.preventDefault()')
  })

  it('keeps horizontal swipes attached and carries their momentum without opening a card', () => {
    expect(source).toContain('node.scrollLeft = startLeft - dx')
    expect(source).toContain('velocity *= Math.pow(0.91')
    expect(source).toContain('suppressClickUntil = performance.now() + 450')
    expect(source).toContain("node.addEventListener('click', onClick, true)")
  })
})
