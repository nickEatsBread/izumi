import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const desktopPlayer = readFileSync(fileURLToPath(new URL(
  '../../../src-tauri/src/player/mod.rs',
  import.meta.url,
)), 'utf8')

describe('embedded mpv efficiency configuration', () => {
  it('chunks cache refills in every desktop player path', () => {
    expect(desktopPlayer.match(/set_option\("demuxer-hysteresis-secs", "10"\)/g)).toHaveLength(2)
  })
})
