export type ProfiledVideoCodec = 'dolby-vision' | 'hevc' | 'av1' | 'vp9'

export interface ParsedCodecProfile {
  codec: ProfiledVideoCodec
  codecString: string
  profile: number
  level: string
  tier?: 'main' | 'high'
  bitDepth?: number
}

const av1Level = (index: number): string => {
  const major = 2 + Math.floor(index / 4)
  return `${major}.${index % 4}`
}

/** Parse the RFC 6381/ISO-BMFF codec forms used by manifests. A filename label is deliberately
 * not accepted: only the container/manifest codec string carries a dependable profile + level. */
export function parseCodecProfile(value: string): ParsedCodecProfile | null {
  const codecString = value.trim().split(/[ ,]/, 1)[0]
  let match = /^(?:dvhe|dvh1|dvav|dva1)\.(\d{2})\.(\d{2})$/i.exec(codecString)
  if (match) {
    return {
      codec: 'dolby-vision', codecString,
      profile: Number(match[1]), level: String(Number(match[2])),
    }
  }

  match = /^(?:hvc1|hev1)\.(\d+)(?:\.[^.]+)*\.([LH])(\d+)(?:\.|$)/i.exec(codecString)
  if (match) {
    const levelIdc = Number(match[3])
    return {
      codec: 'hevc', codecString,
      profile: Number(match[1]), level: Number.isFinite(levelIdc) ? (levelIdc / 30).toFixed(1) : '',
      tier: match[2].toUpperCase() === 'H' ? 'high' : 'main',
      bitDepth: Number(match[1]) === 2 ? 10 : undefined,
    }
  }

  match = /^av01\.(\d)\.(\d{2})([MH])\.(\d{2})(?:\.|$)/i.exec(codecString)
  if (match) {
    return {
      codec: 'av1', codecString,
      profile: Number(match[1]), level: av1Level(Number(match[2])),
      tier: match[3].toUpperCase() === 'H' ? 'high' : 'main', bitDepth: Number(match[4]),
    }
  }

  match = /^vp09\.(\d{2})\.(\d{2})\.(\d{2})(?:\.|$)/i.exec(codecString)
  if (match) {
    return {
      codec: 'vp9', codecString,
      profile: Number(match[1]), level: `${Number(match[2]) / 10}.0`, bitDepth: Number(match[3]),
    }
  }
  return null
}

export interface CodecProfileAvailability {
  dolbyVisionProfiles: string[]
  hevcMain10: boolean
  av1Main10: boolean
  vp9Profile2: boolean
}

export interface CodecProfileAssessment {
  supported: boolean | null
  reason: string
}

/** A preflight guard. Android's final answer still comes from CodecCapabilities.isFormatSupported
 * for the selected track because resolution, frame rate and level must be considered together. */
export function assessCodecProfile(
  parsed: ParsedCodecProfile | null,
  available: CodecProfileAvailability,
): CodecProfileAssessment {
  if (!parsed) return { supported: null, reason: 'No exact manifest/container codec profile was supplied.' }
  if (parsed.codec === 'dolby-vision') {
    const profile = String(parsed.profile)
    const supported = available.dolbyVisionProfiles.some((entry) => entry.split('@', 1)[0] === profile)
    return { supported, reason: supported
      ? `Dolby Vision Profile ${profile}, Level ${parsed.level} is advertised by a decoder.`
      : `No decoder advertises Dolby Vision Profile ${profile}.` }
  }
  if (parsed.codec === 'hevc' && parsed.profile === 2) {
    return { supported: available.hevcMain10, reason: available.hevcMain10
      ? `HEVC Main10 Level ${parsed.level} has a candidate decoder; Android will verify size and frame rate.`
      : 'No HEVC Main10 decoder was reported.' }
  }
  if (parsed.codec === 'av1' && parsed.bitDepth === 10) {
    return { supported: available.av1Main10, reason: available.av1Main10
      ? `AV1 Main 10-bit Level ${parsed.level} has a candidate decoder; Android will verify the exact format.`
      : 'No AV1 Main 10-bit decoder was reported.' }
  }
  if (parsed.codec === 'vp9' && parsed.profile === 2) {
    return { supported: available.vp9Profile2, reason: available.vp9Profile2
      ? `VP9 Profile 2 Level ${parsed.level} has a candidate decoder; Android will verify the exact format.`
      : 'No VP9 Profile 2 decoder was reported.' }
  }
  return { supported: null, reason: `${parsed.codec} Profile ${parsed.profile} is outside this HDR profile check.` }
}
