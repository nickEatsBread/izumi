import { describe, expect, it, vi } from 'vitest'
import {
  assessDrmDolbyVariant,
  chooseDrmDolbyFallback,
  isAtmosCandidateCodec,
  isDolbyVisionCodec,
  mediaCapabilitiesConfiguration,
} from './drm-dolby'

const drm = { keySystem: 'com.widevine.alpha', videoRobustness: 'SW_SECURE_CRYPTO' }
const dvAtmos = {
  id: 1, active: true, width: 3840, height: 2160, frameRate: 24,
  videoCodec: 'dvhe.05.06', videoMimeType: 'video/mp4',
  audioCodec: 'ec-3', audioMimeType: 'audio/mp4', channelsCount: 8,
}

describe('DRM Dolby capability probing', () => {
  it('recognises exact Dolby Vision and Atmos carrier codec strings', () => {
    expect(isDolbyVisionCodec('dvhe.05.06')).toBe(true)
    expect(isDolbyVisionCodec('hvc1.2.4.L153')).toBe(false)
    expect(isAtmosCandidateCodec('ec-3')).toBe(true)
    expect(isAtmosCandidateCodec('mp4a.40.2')).toBe(false)
  })

  it('requests PQ/Rec.2020 and spatial rendering from MediaCapabilities', () => {
    const config = mediaCapabilitiesConfiguration(dvAtmos, drm)
    expect(config.video).toMatchObject({ colorGamut: 'rec2020', transferFunction: 'pq' })
    expect(config.audio).toMatchObject({ spatialRendering: true })
    expect(config.keySystemConfiguration?.keySystem).toBe('com.widevine.alpha')
  })

  it('reports rejection from the CDM/output path', async () => {
    const decodingInfo = vi.fn().mockResolvedValue({ supported: false, smooth: false, powerEfficient: false })
    const result = await assessDrmDolbyVariant(dvAtmos, drm, decodingInfo)
    expect(result).toMatchObject({ dolbyVision: true, atmosCandidate: true, supported: false })
    expect(decodingInfo).toHaveBeenCalledOnce()
  })

  it('keeps unknown playable when the API is unavailable', async () => {
    expect((await assessDrmDolbyVariant(dvAtmos, drm, undefined)).supported).toBeNull()
  })

  it('falls back to the same-language, same-resolution non-Dolby variant', () => {
    const fallback = chooseDrmDolbyFallback([
      dvAtmos,
      { id: 2, height: 2160, audioLanguage: 'eng', videoCodec: 'hvc1', audioCodec: 'mp4a' },
      { id: 3, height: 1080, audioLanguage: 'jpn', videoCodec: 'avc1', audioCodec: 'mp4a' },
    ], [{ id: 1, dolbyVision: true, atmosCandidate: true, supported: false, smooth: false, powerEfficient: false, reason: 'rejected' }])
    expect(fallback?.id).toBe(2)
  })
})
