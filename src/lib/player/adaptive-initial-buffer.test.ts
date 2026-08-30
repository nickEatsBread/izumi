import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const play = readFileSync(fileURLToPath(new URL('../stremio/play.ts', import.meta.url)), 'utf8')
const native = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/player/mod.rs', import.meta.url)), 'utf8')
const bridge = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/lib.rs', import.meta.url)), 'utf8')

describe('transport-aware initial buffering', () => {
  it('uses a short HTTP cushion, keeps one second for P2P, and skips local-file delay', () => {
    expect(play).toContain("directPlaybackId != null ? 1 : /^https?:/i.test(stream.url ?? '') ? 0.25 : 0")
    expect(play).toContain('initialBufferSeconds,')
  })

  it('applies buffer policy and cache size inside the player embed handoff', () => {
    expect(native).toContain('mpv.set_property("cache-pause-initial", initial_buffer > 0.0)')
    expect(native).toContain('mpv.set_property("cache-pause-wait", initial_buffer)')
    expect(bridge).toContain('cache_bytes: Option<u64>')
    expect(play).not.toContain("await invoke('set_player_cache'")
  })
})
