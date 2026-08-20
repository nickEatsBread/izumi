import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('Android centre transport compositor', () => {
  it('does not apply backdrop-filter over the native video surface', () => {
    const source = readFileSync(fileURLToPath(new URL('./AndroidPlayer.svelte', import.meta.url)), 'utf8')
    const button = source.split('\n').find((line) => line.includes('class="transport-button'))
    expect(button).toBeTruthy()
    expect(button).not.toContain('backdrop-blur')
    expect(source).toContain('.transport-button { background:')
    expect(source).toContain('contain: paint')
  })
})
