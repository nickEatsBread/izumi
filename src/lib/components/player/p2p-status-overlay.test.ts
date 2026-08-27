import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('shared P2P status overlay', () => {
  it('is mounted by both built-in players', () => {
    expect(read('./PlayerOverlay.svelte')).toContain('<P2PStatusOverlay buffering={loading} firstFrameSeen={firstFrame} />')
    expect(read('./AndroidPlayer.svelte')).toContain('<P2PStatusOverlay buffering={loading || recovering} {firstFrameSeen} />')
  })

  it('removes startup surfaces synchronously when native video makes WebKit hidden', () => {
    const player = read('./PlayerOverlay.svelte')
    const loadingSurface = player.slice(
      player.indexOf('{#if loading && !gmBitmapMode}'),
      player.indexOf('<div class="izumi-hud"><P2PStatusOverlay'),
    )
    expect(loadingSurface).not.toContain('transition:fade')
    expect(read('./P2PStatusOverlay.svelte')).not.toContain('transition:fade')
  })

  it('shows live transfer and swarm health rather than generic playback stats', () => {
    const overlay = read('./P2PStatusOverlay.svelte')
    for (const field of ['downloadMbps', 'uploadMbps', 'livePeers', 'downloadedBytes', 'selectedSize']) {
      expect(overlay).toContain(`stats.${field}`)
    }
  })

  it('waits for a live torrent before showing Connecting… and hides once a frame is up', () => {
    const overlay = read('./P2PStatusOverlay.svelte')
    expect(overlay).toContain('currentDirectTorrentPlaybackId()')
    const player = read('./PlayerOverlay.svelte')
    expect(player).toContain('pos > 0.05 || !coreIdle')
    expect(player).toContain('mergeSkipSegments(segs, [])')
    expect(player).toContain('SKIP_RETRY_MS')
  })

  it('does not let an inherited pre-frame pause disable Deck recovery', () => {
    const player = read('./PlayerOverlay.svelte')
    expect(player).toContain('paused: paused && firstFrame')
    expect(player).toContain('firstFrame ? !paused : true')
  })
})
