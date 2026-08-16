import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./play.ts', import.meta.url)), 'utf8')

describe('direct torrent priority handoff', () => {
  it('does not release byte-zero priority when player_embed only accepts the URL', () => {
    const accepted = source.indexOf("traceResolve(trace, 'player embed accepted'")
    const waiting = source.indexOf("traceResolve(trace, 'waiting for first video frame')", accepted)
    const between = source.slice(accepted, waiting)

    expect(accepted).toBeGreaterThan(-1)
    expect(waiting).toBeGreaterThan(accepted)
    expect(between).not.toContain('directTorrentPlayerAttached(')
    expect(source.slice(waiting, waiting + 1_200)).toContain('directTorrentPlayerAttached(playbackId)')
  })
})
