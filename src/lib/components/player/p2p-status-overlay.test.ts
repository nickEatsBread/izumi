import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('shared P2P status overlay', () => {
  it('is mounted by both built-in players', () => {
    expect(read('./PlayerOverlay.svelte')).toContain('<P2PStatusOverlay buffering={loading} firstFrameSeen={firstFrame} />')
    expect(read('./AndroidPlayer.svelte')).toContain('<P2PStatusOverlay buffering={loading || recovering} {firstFrameSeen} variant="android" />')
  })

  it('uses Android loading language instead of the desktop floating card', () => {
    const overlay = read('./P2PStatusOverlay.svelte')
    const rail = read('./AndroidConnectionStatus.svelte')
    expect(overlay).toContain("variant?: 'desktop' | 'android'")
    expect(overlay).toContain("variant === 'android' && buffering")
    expect(overlay).toContain('<AndroidConnectionStatus')
    expect(overlay).toContain('placement="player"')
    expect(overlay).toContain('Loading from P2P peers')
    expect(rail).toContain("placement?: 'preparing' | 'player'")
    expect(rail).toContain('class="bar-loader h-full w-full"')
  })

  it('keeps Android always-visible stats compact and clear of the timeline', () => {
    const overlay = read('./P2PStatusOverlay.svelte')
    expect(overlay).toContain('This compact readout also stays clear of the timeline')
    expect(overlay).toContain('top-3')
  })

  it('renders desktop status as a bare top-edge row, not a floating card', () => {
    const overlay = read('./P2PStatusOverlay.svelte')
    expect(overlay).not.toContain('P2P activity')
    expect(overlay).not.toContain('calc(50% + 4.25rem)')
    expect(overlay).toContain('absolute inset-x-0 top-0 z-20 flex items-center justify-center')
    for (const icon of ['icons/users', 'icons/chevron-down', 'icons/chevron-up']) expect(overlay).toContain(icon)
    expect(overlay).toContain('formatBitRate(downloadMbps)')
    expect(overlay).toContain('formatBitRate(uploadMbps)')
    // One colour throughout: white text and icons with a faint shadow, no per-direction tint.
    expect(overlay).toContain('font-bold text-neutral-50')
    expect(overlay).not.toMatch(/<Chevron(Down|Up)[^>]*text-(green|blue|emerald|sky)-/)
  })

  it('follows only the P2P status setting, never the controls', () => {
    const overlay = read('./P2PStatusOverlay.svelte')
    expect(overlay).not.toContain('controlsVisible')
    expect(overlay).toContain('const visible = $derived(shouldShowP2PStatus(')
  })

  it('moves the top-centre toast below the status row instead of overlapping it', () => {
    const player = read('./PlayerOverlay.svelte')
    expect(player).toContain("p2pVisible ? (gmMode ? 'top-[4.5rem]' : 'top-14')")
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
