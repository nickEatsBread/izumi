import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('player quality settings', () => {
  it('exposes video quality on Android instead of treating playback as an external app', () => {
    expect(page).not.toContain('On Android playback hands off to an external app')
    expect(page).toContain('embedded Android libmpv plugin')
    expect(page).toContain('ariaLabel="Video quality"')
  })

  it('keeps Anime shaders desktop-only', () => {
    expect(page).toContain('$isAndroid ? []')
    expect(page).toContain("value: 'anime'")
  })

  it('only shows Direct3D driver upscaling on Windows', () => {
    expect(page).toContain("import { isAndroid, isWindows } from '$lib/platform'")
    expect(page).toMatch(/\{#if \$isWindows\}[\s\S]{0,200}Windows driver upscaling/)
    expect(page).not.toMatch(/\{#if !\$isAndroid\}[\s\S]{0,200}Windows driver upscaling/)
  })
})
