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

describe('Steam Deck browse loading', () => {
  it('starts every home-row query before controller scroll reaches its loading boundary', () => {
    expect(row).toContain('const active = $derived(visible || $gameMode)')
    expect(row).toContain('pause: !active')
  })

  it('animates discrete controller presses without queuing held-repeat motion', () => {
    expect(nav).toContain("rapid ? 'auto' : 'smooth'")
  })
})
