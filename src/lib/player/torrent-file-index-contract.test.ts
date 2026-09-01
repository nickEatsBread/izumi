import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const play = readFileSync(fileURLToPath(new URL('../stremio/play.ts', import.meta.url)), 'utf8')
const torrent = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/direct_torrent.rs', import.meta.url)), 'utf8')
const selection = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/direct_torrent_select.rs', import.meta.url)), 'utf8')

describe('Stremio torrent fileIdx contract', () => {
  it('passes the authoritative index into local, linked-device, and next-episode native selection', () => {
    expect(play.match(/preferredFileIndex: .*\.fileIdx/g)).toHaveLength(3)
    expect(torrent).toContain('preferred_file_index: Option<usize>')
    expect(torrent).toContain('select_file_by_index(&files, index)')
    expect(selection).toContain('file.index == index && is_video(&file.name)')
  })
})
