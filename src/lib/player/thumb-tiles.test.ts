import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

type TileEvent = { payload: { key: string; index: number; dataUrl: string } }
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, ((event: TileEvent) => void)[]>(),
  invoke: vi.fn(async (_command: string, _args: Record<string, unknown>) => true as boolean),
}))

vi.mock('$lib/util/listen', () => ({
  listenSafe: (event: string, handler: (event: TileEvent) => void) => {
    mocks.handlers.set(event, [...(mocks.handlers.get(event) ?? []), handler])
    return () => {}
  },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('./session', () => ({ spriteKey: writable<string | null>(null) }))
vi.stubGlobal('window', { devicePixelRatio: 2 })

import { spriteKey } from './session'
import { onThumbReset, onThumbTile, registerThumbTiles, thumbEpoch, thumbTiles } from './thumb-tiles'

const push = (key: string, index: number, dataUrl: string) => {
  for (const handler of mocks.handlers.get('player-thumb-tile') ?? []) handler({ payload: { key, index, dataUrl } })
}
const reset = () => {
  for (const handler of mocks.handlers.get('player-thumb-reset') ?? []) handler({ payload: { key: '', index: 0, dataUrl: '' } })
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('scrub tile cache', () => {
  beforeEach(() => {
    mocks.invoke.mockClear()
    mocks.invoke.mockResolvedValue(true)
  })

  it('asks Rust once per loaded file, at the screen pixel size', async () => {
    spriteKey.set('episode-a')
    registerThumbTiles('episode-a', 'file-a')
    registerThumbTiles('episode-a', 'file-a')
    await settle()
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('player_sprite_start', { key: 'episode-a', url: 'file-a', width: 384 })
    expect(mocks.handlers.get('player-thumb-tile')).toHaveLength(1)
  })

  it('asks again while Rust declines a file that is not loaded yet', async () => {
    mocks.invoke.mockResolvedValue(false)
    registerThumbTiles('episode-a', 'file-b')
    await settle()
    mocks.invoke.mockResolvedValue(true)
    registerThumbTiles('episode-a', 'file-b')
    await settle()
    registerThumbTiles('episode-a', 'file-b')
    await settle()
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
  })

  it('keeps tiles pushed for the playing stream across seek bar mounts', () => {
    spriteKey.set('episode-a')
    const seen: number[] = []
    const stop = onThumbTile((index) => seen.push(index))
    push('episode-a', 3, 'data:a3')
    stop()
    push('episode-a', 4, 'data:a4')

    // A seek bar mounted later still finds both, and only the live subscriber heard about one.
    expect(thumbTiles('episode-a').get(3)).toBe('data:a3')
    expect(thumbTiles('episode-a').get(4)).toBe('data:a4')
    expect(seen).toEqual([3])
  })

  it('drops every tile when Rust replaces the grid under the same key', async () => {
    spriteKey.set('episode-a')
    push('episode-a', 5, 'data:first-file')
    const epoch = thumbEpoch()
    let resets = 0
    const stop = onThumbReset(() => { resets += 1 })
    reset()
    stop()

    expect(thumbTiles('episode-a').size).toBe(0)
    expect(thumbEpoch()).not.toBe(epoch)
    expect(resets).toBe(1)
    // The next file under the same key is registered again.
    registerThumbTiles('episode-a', 'file-a')
    await settle()
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })

  it('ignores another stream and empties when the stream changes', () => {
    spriteKey.set('episode-a')
    push('episode-a', 1, 'data:a1')
    push('episode-b', 2, 'data:b2')
    expect(thumbTiles('episode-a').has(2)).toBe(false)

    spriteKey.set('episode-b')
    expect(thumbTiles('episode-b').size).toBe(0)
    push('episode-b', 2, 'data:b2')
    expect(thumbTiles('episode-b').get(2)).toBe('data:b2')
    expect(thumbTiles('episode-b').has(1)).toBe(false)
  })
})
