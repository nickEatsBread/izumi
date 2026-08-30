import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { confirmedNativeAndroidAudioRoute, nativeAndroidAudioRoute } from './android-mpv'

const plugin = readFileSync(fileURLToPath(new URL(
  '../../../src-tauri/tauri-plugin-mpv/android/src/main/java/app/izumi/mpv/MpvPlugin.kt',
  import.meta.url,
)), 'utf8')
const play = readFileSync(fileURLToPath(new URL('../stremio/play.ts', import.meta.url)), 'utf8')

describe('Android native media route', () => {
  it('uses Media3 only for clearly identified SDR AC-4 audio', () => {
    expect(nativeAndroidAudioRoute('AC-4')).toBe('ac4')
    expect(nativeAndroidAudioRoute('AC4')).toBe('ac4')
    expect(nativeAndroidAudioRoute('Show S01E01 Dual Audio AC-4 1080p')).toBe('ac4')
    expect(nativeAndroidAudioRoute('E-AC-3')).toBeUndefined()
    expect(nativeAndroidAudioRoute('AC-4', 'HDR10')).toBeUndefined()
  })

  it('requires the bounded extractor to confirm an actual AC-4 track', () => {
    const inspection = {
      status: 'ok' as const,
      bounded: true as const,
      redacted: true as const,
      tracks: [{ type: 'audio' as const, sampleMimeType: 'audio/ac4' }],
    }
    expect(confirmedNativeAndroidAudioRoute('ac4', inspection)).toBe('ac4')
    expect(confirmedNativeAndroidAudioRoute('ac4', { ...inspection, tracks: [{ type: 'audio', sampleMimeType: 'audio/eac3' }] })).toBeUndefined()
    expect(confirmedNativeAndroidAudioRoute('ac4', { ...inspection, status: 'timeout' })).toBeUndefined()
  })

  it('reuses the native player while replacing per-source headers', () => {
    const load = plugin.slice(
      plugin.indexOf('private fun loadNativeMedia'),
      plugin.indexOf('private fun releaseNativeMedia'),
    )
    expect(load).toContain('val canReuse = existingPlayer != null && existingView != null && container != null')
    expect(load).toContain('player = existingPlayer!!')
    expect(load).toContain('.setDefaultRequestProperties(args.headers)')
    expect(load).toContain('DefaultMediaSourceFactory(dataSourceFactory).createMediaSource(item)')
    expect(load).toContain('player.setMediaSource(mediaSource,')
  })

  it('requires a device codec or routed AC-4 endpoint and keeps mpv as fallback', () => {
    expect(plugin).toContain('it.equals(MimeTypes.AUDIO_AC4, ignoreCase = true)')
    expect(plugin).toContain('directAudioSupported(manager, AudioFormat.ENCODING_AC4)')
    expect(plugin).toContain('loadNativeMedia(args, "audio-$nativeAudio")')
    expect(plugin).toContain('loadWithMpv(args)')
  })

  it('does not bypass active audio or video filters', () => {
    expect(play).toContain("const nativeTransformsOff = get(audioProcessing) === 'off' && !filterChains.af && !filterChains.vf")
    expect(play).toContain('confirmedNativeAndroidAudioRoute(nativeAudioCandidate, inspection)')
    expect(play).toContain('preferNativeAudio: nativeAudio')
  })
})
