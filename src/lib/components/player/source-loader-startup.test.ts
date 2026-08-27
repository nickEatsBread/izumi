import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const loader = read('./SourceLoader.svelte')
const css = read('../../../app.css')
const play = read('../../stremio/play.ts')

describe('connecting loader startup', () => {
  it('uses one compositor-driven loader before and after the lazy component swap', () => {
    expect(loader).toContain('class="bar-loader h-1 w-40')
    expect(loader).not.toContain('<animate')
    expect(css).toMatch(/\.bar-loader::before[\s\S]*will-change: transform/)
  })

  it('paints the loader before playback setup continues', () => {
    expect(play).toContain('async function paintConnectingLoader()')
    expect(play).toMatch(/connecting\.set\(\{[\s\S]{0,700}await paintConnectingLoader\(\)[\s\S]{0,100}if \(!stillOwnsPlayback\(\)\) return/)
  })
})
