// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { canPool, clearParkedPlayer, PARK_MS, parkPlayer, takePlayer } from './youtube-pool'

const proto = Element.prototype as Element & { moveBefore?: (node: Node, child: Node | null) => void }
const frame = () => { const el = document.createElement('iframe'); document.body.append(el); return el }
const box = () => { const el = document.createElement('div'); document.body.append(el); return el }

describe('YouTube player pool', () => {
  afterEach(() => { clearParkedPlayer(); delete proto.moveBefore; document.body.innerHTML = ''; vi.useRealTimers() })

  it('keeps nothing where an iframe cannot move without reloading', () => {
    expect(canPool()).toBe(false)
    const el = frame()
    expect(parkPlayer(el, 'direct')).toBe(false)
    expect(takePlayer('direct', box())).toBeUndefined()
  })

  describe('with moveBefore', () => {
    beforeEach(() => { proto.moveBefore = function (this: Element, node: Node, child: Node | null) { this.insertBefore(node, child) } })

    it('hands the parked player to the next trailer with the same embed setup, once', () => {
      const el = frame()
      expect(parkPlayer(el, 'direct')).toBe(true)
      expect(el.parentElement?.id).toBe('izumi-youtube-lot')
      expect(takePlayer('http://127.0.0.1:1', box())).toBeUndefined()
      const into = box()
      expect(takePlayer('direct', into)).toBe(el)
      expect(el.parentElement).toBe(into)
      expect(takePlayer('direct', box())).toBeUndefined()
    })

    it('keeps one spare, closes it after a minute unused, and never parks a player already gone', () => {
      vi.useFakeTimers()
      const first = frame()
      const second = frame()
      parkPlayer(first, 'direct')
      parkPlayer(second, 'direct')
      expect(first.isConnected).toBe(false)
      vi.advanceTimersByTime(PARK_MS)
      expect(second.isConnected).toBe(false)
      expect(takePlayer('direct', box())).toBeUndefined()
      const gone = document.createElement('iframe')
      expect(parkPlayer(gone, 'direct')).toBe(false)
    })
  })

  it('parks on the way out, since Svelte removes a block before its teardowns run', () => {
    const trailer = readFileSync('src/lib/components/cards/YoutubeTrailer.svelte', 'utf8')
    expect(trailer).toContain('<div bind:this={host} class="contents" out:parkOnExit|global></div>')
    expect(trailer).toContain("command(reused, source, 'loadVideoById', [id])")
    expect(trailer).toContain('parkPlayer(current.el, poolKey(current.source))')
  })
})
