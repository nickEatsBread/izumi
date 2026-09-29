// Tailwind only knows the colours tailwind.config.ts declares, and a class for any other name emits no
// CSS at all: `bg-popover` left the top bar's search results and the player toolbar's menus with no
// background, so they read as see-through over the artwork behind them.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const svelteFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? svelteFiles(path) : path.endsWith('.svelte') ? [path] : []
})

describe('surface colours', () => {
  it('uses only colour names the Tailwind config declares', () => {
    const config = readFileSync(join(root, '..', 'tailwind.config.ts'), 'utf8')
    expect(config).not.toContain('popover')
    for (const file of svelteFiles(root)) expect(readFileSync(file, 'utf8'), file).not.toMatch(/\b(?:bg|text|border)-popover\b/)
  })
})
