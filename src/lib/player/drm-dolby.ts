import { writable } from 'svelte/store'
import type { StreamDrm } from './drm'

export interface DrmDolbyVariant {
  id?: number
  active?: boolean
  language?: string
  audioLanguage?: string
  width?: number
  height?: number
  frameRate?: number
  bandwidth?: number
  videoBandwidth?: number
  audioBandwidth?: number
  channelsCount?: number
  audioSamplingRate?: number
  videoMimeType?: string
  audioMimeType?: string
  videoCodec?: string
  audioCodec?: string
  codecs?: string
  hdr?: string
}

export interface DrmDolbyAssessment {
  id?: number
  dolbyVision: boolean
  atmosCandidate: boolean
  supported: boolean | null
  smooth: boolean | null
  powerEfficient: boolean | null
  reason: string
}

export interface DrmDolbyStatus {
  checked: boolean
  dolbyVision: 'inactive' | 'supported' | 'unsupported' | 'unknown'
  atmos: 'inactive' | 'supported' | 'unsupported' | 'unknown'
  fallbackApplied: boolean
  detail: string
}

export const drmDolbyStatus = writable<DrmDolbyStatus>({
  checked: false,
  dolbyVision: 'inactive',
  atmos: 'inactive',
  fallbackApplied: false,
  detail: '',
})

export const isDolbyVisionCodec = (codec = '') => /(?:^|[,\s])(?:dvhe|dvh1|dvav|dva1)\./i.test(codec)
export const isAtmosCandidateCodec = (codec = '') => /(?:ec-3|eac3|e-ac-3|truehd|mlp)/i.test(codec)

function contentType(mime: string | undefined, codec: string): string {
  const base = mime || (codec && isDolbyVisionCodec(codec) ? 'video/mp4' : 'application/octet-stream')
  return codec ? `${base}; codecs="${codec}"` : base
}

export function mediaCapabilitiesConfiguration(
  variant: DrmDolbyVariant,
  drm: Pick<StreamDrm, 'keySystem' | 'videoRobustness' | 'audioRobustness'>,
): MediaDecodingConfiguration {
  const videoCodec = variant.videoCodec || ''
  const audioCodec = variant.audioCodec || ''
  const config: MediaDecodingConfiguration = {
    type: 'media-source',
    keySystemConfiguration: {
      keySystem: drm.keySystem,
      initDataType: 'cenc',
      distinctiveIdentifier: 'optional',
      persistentState: 'optional',
      sessionTypes: ['temporary'],
      video: { robustness: drm.videoRobustness || 'SW_SECURE_CRYPTO' },
      audio: { robustness: drm.audioRobustness || drm.videoRobustness || 'SW_SECURE_CRYPTO' },
    },
  }
  if (videoCodec) {
    config.video = {
      contentType: contentType(variant.videoMimeType || 'video/mp4', videoCodec),
      width: Math.max(1, variant.width || 1920),
      height: Math.max(1, variant.height || 1080),
      bitrate: Math.max(1, variant.videoBandwidth || variant.bandwidth || 8_000_000),
      framerate: Math.max(1, variant.frameRate || 24),
      ...(isDolbyVisionCodec(videoCodec)
        ? { colorGamut: 'rec2020' as ColorGamut, transferFunction: 'pq' as TransferFunction }
        : {}),
    }
  }
  if (audioCodec) {
    config.audio = {
      contentType: contentType(variant.audioMimeType || 'audio/mp4', audioCodec),
      channels: String(Math.max(2, variant.channelsCount || 2)),
      bitrate: Math.max(1, variant.audioBandwidth || 768_000),
      samplerate: Math.max(1, variant.audioSamplingRate || 48_000),
      spatialRendering: isAtmosCandidateCodec(audioCodec),
    }
  }
  return config
}

export async function assessDrmDolbyVariant(
  variant: DrmDolbyVariant,
  drm: Pick<StreamDrm, 'keySystem' | 'videoRobustness' | 'audioRobustness'>,
  decodingInfo: ((configuration: MediaDecodingConfiguration) => Promise<MediaCapabilitiesDecodingInfo>) | undefined =
    typeof navigator === 'undefined' ? undefined : navigator.mediaCapabilities?.decodingInfo.bind(navigator.mediaCapabilities),
): Promise<DrmDolbyAssessment> {
  const videoCodec = variant.videoCodec || ''
  const audioCodec = variant.audioCodec || ''
  const dolbyVision = isDolbyVisionCodec(videoCodec)
  const atmosCandidate = isAtmosCandidateCodec(audioCodec)
  if (!dolbyVision && !atmosCandidate) {
    return { id: variant.id, dolbyVision, atmosCandidate, supported: true, smooth: null, powerEfficient: null, reason: 'not a Dolby variant' }
  }
  if (!decodingInfo) {
    return { id: variant.id, dolbyVision, atmosCandidate, supported: null, smooth: null, powerEfficient: null, reason: 'MediaCapabilities API unavailable' }
  }
  try {
    const result = await decodingInfo(mediaCapabilitiesConfiguration(variant, drm))
    return {
      id: variant.id,
      dolbyVision,
      atmosCandidate,
      supported: result.supported,
      smooth: result.smooth,
      powerEfficient: result.powerEfficient,
      reason: result.supported ? 'CDM and output path accepted the exact codecs' : 'CDM or output path rejected the exact codecs',
    }
  } catch (error) {
    return {
      id: variant.id,
      dolbyVision,
      atmosCandidate,
      supported: null,
      smooth: null,
      powerEfficient: null,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function assessDrmDolbyVariants(
  variants: DrmDolbyVariant[],
  drm: Pick<StreamDrm, 'keySystem' | 'videoRobustness' | 'audioRobustness'>,
  decodingInfo?: (configuration: MediaDecodingConfiguration) => Promise<MediaCapabilitiesDecodingInfo>,
): Promise<DrmDolbyAssessment[]> {
  return Promise.all(variants.map((variant) => assessDrmDolbyVariant(variant, drm, decodingInfo)))
}

/** Choose a non-rejected variant at the same resolution/language where possible. Unknown remains
 * playable: absence of MediaCapabilities must not turn an otherwise valid Shaka/CDM route off. */
export function chooseDrmDolbyFallback(
  variants: DrmDolbyVariant[],
  assessments: DrmDolbyAssessment[],
): DrmDolbyVariant | undefined {
  const active = variants.find((variant) => variant.active)
  if (!active) return undefined
  const assessment = assessments.find((item) => item.id === active.id)
  if (assessment?.supported !== false) return undefined
  const rejected = new Set(assessments.filter((item) => item.supported === false).map((item) => item.id))
  const activeLang = active.audioLanguage || active.language || ''
  return variants
    .filter((variant) => !rejected.has(variant.id))
    .sort((a, b) => {
      const aLang = (a.audioLanguage || a.language || '') === activeLang ? 0 : 1
      const bLang = (b.audioLanguage || b.language || '') === activeLang ? 0 : 1
      if (aLang !== bLang) return aLang - bLang
      const aHeight = Math.abs((a.height || 0) - (active.height || 0))
      const bHeight = Math.abs((b.height || 0) - (active.height || 0))
      if (aHeight !== bHeight) return aHeight - bHeight
      return (b.bandwidth || 0) - (a.bandwidth || 0)
    })[0]
}

export function summarizeDrmDolby(
  active: DrmDolbyVariant | undefined,
  assessment: DrmDolbyAssessment | undefined,
  fallbackApplied: boolean,
): DrmDolbyStatus {
  if (!active || !assessment) return { checked: false, dolbyVision: 'inactive', atmos: 'inactive', fallbackApplied, detail: '' }
  const state = assessment.supported == null ? 'unknown' : assessment.supported ? 'supported' : 'unsupported'
  return {
    checked: true,
    dolbyVision: assessment.dolbyVision ? state : 'inactive',
    atmos: assessment.atmosCandidate ? state : 'inactive',
    fallbackApplied,
    detail: assessment.reason,
  }
}
