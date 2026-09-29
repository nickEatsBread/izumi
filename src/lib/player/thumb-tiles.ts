import { get } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { listenSafe } from '$lib/util/listen'
import { spriteKey } from './session'

/** Scrub-preview tiles for the file that is playing: tile index → JPEG data URL. Kept outside
 *  the seek bar because the player controls unmount it every time they hide. A remounted bar
 *  finds every tile rendered so far, including the ones rendered in the background meanwhile. */
const tiles = new Map<number, string>()
let tilesKey: string | null = null
/** Counts the grids Rust has started or dropped. A tile fetched across a change may be a frame of
 *  the file that was replaced. */
let epoch = 0
/** Stream key and URL of the grid asked for last, so progress ticks do not ask twice. */
let requested: string | null = null
const tileSubscribers = new Set<(index: number, dataUrl: string) => void>()
const resetSubscribers = new Set<() => void>()
let collecting = false

/** Tooltip frames are 192 CSS px wide (w-48). Render at the screen's real pixel size so they stay
 *  sharp on high-density displays. */
const tileWidth = () => Math.min(480, Math.max(240, Math.round(192 * (window.devicePixelRatio || 1))))

/** The tile cache for stream `key`. It empties when the stream changes. */
export function thumbTiles(key: string | null): Map<number, string> {
  if (key !== tilesKey) {
    tiles.clear()
    tilesKey = key
  }
  return tiles
}

/** Changes whenever the tiles held so far stop describing the file that is playing. */
export const thumbEpoch = () => epoch

function collectThumbTiles(): void {
  if (collecting) return
  collecting = true
  listenSafe<{ key: string; index: number; dataUrl: string }>('player-thumb-tile', (event) => {
    const { key, index, dataUrl } = event.payload
    if (key !== get(spriteKey)) return
    thumbTiles(key).set(index, dataUrl)
    for (const subscriber of tileSubscribers) subscriber(index, dataUrl)
  })
  // Rust started a new grid or dropped one (another file loaded, the player closed): any tile held
  // so far may be a frame of a different file.
  listenSafe('player-thumb-reset', () => {
    tiles.clear()
    epoch += 1
    requested = null
    for (const subscriber of resetSubscribers) subscriber()
  })
}

/** Have Rust render the scrub previews of `url`, the file loaded as stream `key`. Safe to call on
 *  every progress tick: Rust declines until that file is loaded and its length is known, and a
 *  grid already asked for is not asked for again. */
export function registerThumbTiles(key: string, url: string): void {
  collectThumbTiles()
  const id = `${key}\n${url}`
  if (requested === id) return
  requested = id
  const retry = () => { if (requested === id) requested = null }
  invoke<boolean>('player_sprite_start', { key, url, width: tileWidth() })
    .then((accepted) => { if (!accepted) retry() })
    .catch(retry)
}

/** Called with each tile as it arrives. Returns the unsubscribe function. */
export function onThumbTile(subscriber: (index: number, dataUrl: string) => void): () => void {
  tileSubscribers.add(subscriber)
  return () => { tileSubscribers.delete(subscriber) }
}

/** Called when the tiles held so far are dropped. Returns the unsubscribe function. */
export function onThumbReset(subscriber: () => void): () => void {
  resetSubscribers.add(subscriber)
  return () => { resetSubscribers.delete(subscriber) }
}
