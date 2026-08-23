import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const row = readFileSync(
  fileURLToPath(new URL('../../../lib/components/cards/HomeRow.svelte', import.meta.url)),
  'utf8',
)
const nav = readFileSync(
  fileURLToPath(new URL('../../../lib/nav/index.ts', import.meta.url)),
  'utf8',
)
const performanceClient = readFileSync(
  fileURLToPath(new URL('../../../lib/performance/client.ts', import.meta.url)),
  'utf8',
)
const bootWork = readFileSync(
  fileURLToPath(new URL('../../../lib/util/boot-work.ts', import.meta.url)),
  'utf8',
)

describe('Steam Deck browse loading', () => {
  it('defers each home-row query until controller scroll nears it', () => {
    expect(row).toContain('const active = $derived(visible)')
    expect(row).toContain('pause: !active')
    expect(row).not.toContain('visible || $gameMode')
  })

  it('smoothly carries single focus moves and makes held repeats immediate', () => {
    expect(nav).toContain("const behavior: ScrollBehavior = rapid || reduced ? 'auto' : 'smooth'")
    expect(nav).toContain('endMargin: clamp(portHeight * 0.2, 64, 144)')
    expect(nav).toContain('endMargin: clamp(portWidth * 0.18, 48, 176)')
    expect(nav).toContain("if (!top && !left) return")
  })

  it('does not run a continuous startup sampler or treat animation scroll as fresh input', () => {
    expect(performanceClient).not.toContain('STARTUP_FRAME_WINDOW_MS')
    expect(performanceClient).not.toContain('requestAnimationFrame(sampleFrame)')
    expect(bootWork).toContain("['pointerdown', 'touchstart', 'wheel', 'keydown']")
    expect(bootWork).not.toContain("'keydown', 'scroll'")
  })
})
