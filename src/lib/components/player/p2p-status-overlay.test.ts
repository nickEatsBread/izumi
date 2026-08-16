import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('shared P2P status overlay', () => {
  it('is mounted by both built-in players', () => {
    expect(read('./PlayerOverlay.svelte')).toContain('<P2PStatusOverlay buffering={loading} firstFrameSeen={firstFrame} />')
    expect(read('./AndroidPlayer.svelte')).toContain('<P2PStatusOverlay buffering={loading || recovering} {firstFrameSeen} />')
  })

  it('shows live transfer and swarm health rather than generic playback stats', () => {
    const overlay = read('./P2PStatusOverlay.svelte')
    for (const field of ['downloadMbps', 'uploadMbps', 'livePeers', 'downloadedBytes', 'selectedSize']) {
      expect(overlay).toContain(`stats.${field}`)
    }
  })
})
