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
const css = readFileSync(
  fileURLToPath(new URL('../../../app.css', import.meta.url)),
  'utf8',
)

describe('Steam Deck browse loading', () => {
  it('defers each home-row query until controller scroll nears it', () => {
    expect(row).toContain('const active = $derived(visible)')
    expect(row).toContain('pause: !active')
    expect(row).not.toContain('visible || $gameMode')
  })

  it('uses instant Deck reveals without inheriting document smooth scrolling', () => {
    expect(nav).toContain("const behavior: ScrollBehavior = get(gameMode) || rapid || reduced ? 'auto' : 'smooth'")
    expect(css).toContain('html.gamemode, html.gamemode body { scroll-behavior: auto; }')
    expect(nav).toContain('endMargin: clamp(portHeight * 0.2, 64, 144)')
    expect(nav).toContain('endMargin: clamp(portWidth * 0.18, 48, 176)')
    expect(nav).toContain("if (!top && !left) return")
  })

  it('moves between browse rows before falling back to a whole-page geometry pass', () => {
    const scoped = nav.indexOf('const rowPick = pickInNavRows(active, dir)')
    const global = nav.indexOf('const els = focusables(root)', scoped)
    expect(scoped).toBeGreaterThan(-1)
    expect(global).toBeGreaterThan(scoped)
    expect(nav).toContain("targetRow.querySelector<HTMLElement>('[data-nav-row-default][data-focusable]')")
    expect(nav).toContain("window.scrollTo({ top: 0, behavior })")
  })

  it('renders the Deck focus ring without scaling a newly focused poster layer', () => {
    const focusCover = css.slice(css.indexOf('.gamemode [data-focusable]:focus .focus-cover {'))
    expect(focusCover).toContain('transform: none;')
    expect(focusCover).toContain('transition: none;')
    expect(focusCover).toContain('.gamemode [data-focusable]:focus .focus-cover::after')
    expect(focusCover).toContain('border: 3px solid #fff;')
  })

  it('does not run a continuous startup sampler or treat animation scroll as fresh input', () => {
    expect(performanceClient).not.toContain('STARTUP_FRAME_WINDOW_MS')
    expect(performanceClient).not.toContain('requestAnimationFrame(sampleFrame)')
    expect(bootWork).toContain("['pointerdown', 'touchstart', 'wheel', 'keydown']")
    expect(bootWork).not.toContain("'keydown', 'scroll'")
  })
})
