import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Wiring contract for protected playback across episodes. The presentation choice itself is tested in
// player/preferred-drm.test.ts; these pin where the components feed it and announce what changed.
const surface = readFileSync(new URL('./DrmSurface.svelte', import.meta.url), 'utf8')
const native = readFileSync(new URL('./NativeDrmSurface.svelte', import.meta.url), 'utf8')
const overlay = readFileSync(new URL('./PlayerOverlay.svelte', import.meta.url), 'utf8')
const controls = readFileSync(new URL('./Controls.svelte', import.meta.url), 'utf8')

describe('protected playback across episodes', () => {
  it('opens the series remembered tracks on the first load instead of reloading after the first frame', () => {
    for (const source of [surface, native]) {
      expect(source).toContain("rememberedAudio: rememberedSeriesTrack(")
      expect(source).toContain("rememberedSubtitle: rememberedSeriesTrack(")
    }
    // The audio menu ticks what the manifest plays, not what the source's catalog served first.
    expect(surface).toContain("return manifestQuery('audio') || liveAudioLang || audioLang")
    expect(surface).toContain('const current = currentAudioLang()')
    // That version's catalog lists its own subtitles.
    expect(surface).toContain("if (manifestQuery('audio')) await refreshSidecarSource()")
  })

  it('keeps the spinner up while a presentation switch reloads the stream', () => {
    expect(surface).toContain('paused: switching ? switchPaused : video?.paused ?? true')
    expect(surface).toMatch(/switchPaused = paused\s*const previous/)
  })

  it('announces each track list change so the Audio and Subtitles buttons read it again', () => {
    expect(surface).toMatch(/function announceTracks\(\) \{[\s\S]*?lateSubtitleRevision\.update\(\(n\) => n \+ 1\)/)
    expect(surface.match(/announceTracks\(\)/g)?.length).toBeGreaterThanOrEqual(4)
    expect(controls).toMatch(/const revision = \$torrentSubtitleState\.revision \+ \$lateSubtitleRevision\s*if \(\(showTracks \|\| showOptions \|\| trackWords\) && revision > 0\) void refreshTracks\(\)/)
    // The overlay's mpv subtitle policy must not run on the webview player's announcements.
    expect(overlay).toMatch(/if \(drmWebview \|\| !firstFrame \|\| !key/)
  })

  it('brings the rating card with the first frame of every load, not only on mpv file loads', () => {
    expect(overlay).toContain("listen<string>('player-file-loaded', showRatingCard)")
    expect(overlay).toContain('$effect(() => { if (firstFrame && ratingLabel) untrack(showRatingCard) })')
    expect(overlay).toMatch(/function showRatingCard\(\) \{\s*if \(!ratingLabel \|\| ratingFor === loadedKey\) return/)
  })
})
