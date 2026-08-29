import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const list = readFileSync(fileURLToPath(new URL('./EpisodeList.svelte', import.meta.url)), 'utf8')
const card = readFileSync(fileURLToPath(new URL('./EpisodeCard.svelte', import.meta.url)), 'utf8')

describe('episode Shift+click', () => {
  it('marks progress through the clicked episode instead of playing it', () => {
    expect(list).toContain("import { markWatched } from '$lib/trackers'")
    expect(list).toContain('if (event?.shiftKey) { markWatched(media, ep); return }')
  })

  it('keeps download selection mode in control of modified clicks', () => {
    const tap = list.slice(list.indexOf('function tap('), list.indexOf('function startSelect('))
    expect(tap.indexOf('if (!selecting)')).toBeLessThan(tap.indexOf('event?.shiftKey'))
    expect(tap).toContain('n.has(ep) ? n.delete(ep) : n.add(ep)')
  })

  it('forwards mouse events from every episode layout', () => {
    expect(list.match(/tap\(ep, event\)/g)).toHaveLength(5)
    expect(card).toContain('onplay: (ep: number, event?: MouseEvent) => void')
    expect(card).toContain('onplay(ep, event)')
  })

  it('prevents native selection of episode cards while Shift is held', () => {
    expect(list.match(/class="grid select-none/g)).toHaveLength(6)
    expect(card).toContain('class="group select-none')
  })
})
