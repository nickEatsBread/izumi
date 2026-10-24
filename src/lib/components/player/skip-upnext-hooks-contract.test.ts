import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The Skip button and the Up Next card carry styling hooks so a theme can restyle them.
const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')

describe('Skip and Up Next styling hooks', () => {
  it('the Skip button is a player.skip part named by its segment kind', () => {
    expect(read('PlayerOverlay.svelte')).toContain('data-part="player.skip" data-kind={currentSeg.type}')
  })

  it('the Up Next card exposes its parts and buttons', () => {
    const up = read('UpNextOverlay.svelte')
    for (const hook of [
      'data-part="player.upnext"',
      'data-part="player.upnext.art"',
      'data-part="player.upnext.kicker"',
      'data-part="player.upnext.title"',
      'data-part="player.upnext.countdown"',
      'data-control="upnext-stay"',
      'data-control="upnext-play"',
    ]) expect(up).toContain(hook)
  })
})
