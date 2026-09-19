import type { Stream } from './parse'

/** Explicit extra markers are evidence; missing release metadata is not. */
// Trailer/teaser vocabulary beyond English: uploaders on non-English trackers label a trailer
// pack in their own language while the release title stays in English.
const SUPPLEMENTAL_WORDS = /(?<![\p{L}\p{N}])(?:trailer|teaser|prologue|preview|sample|featurette|promo|behind the scenes|deleted scenes|making of|tlr\d*|tsr\d*|трейлер|тизер|tráiler|bande annonce)(?![\p{L}\p{N}])/iu

export function isSupplementalVideo(stream: Stream, title = ''): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const identity = normalize(title)
  let path = ''
  try { path = decodeURIComponent(new URL(stream.url || '').pathname).split('/').pop() || '' } catch { /* Opaque URLs have no filename evidence. */ }
  return [stream.behaviorHints?.filename, stream.title, stream.description, stream.name, path].some(value => {
    if (!value) return false
    let text = normalize(value)
    if (identity) text = text.split(identity).join(' ')
    // tlr/tsr are the scene's own trailer/teaser abbreviations ("Title_TLR-2_4K…").
    return SUPPLEMENTAL_WORDS.test(text)
  })
}

export interface TvVideoCapabilities {
  hdr?: boolean
  uhd?: boolean
  av1?: boolean
  /** Opus/FLAC audio decoding; older TV web engines lack both. */
  opus?: boolean
  flac?: boolean
}

// Audio a release may declare alongside a codec the TV cannot decode. If any of these is present
// the file carries a playable track (dual-codec releases are common), so only single-codec rows
// are rejected.
const DECODABLE_AUDIO = /\b(?:aac|ac-?3|e-?ac-?3|ddp?\+?(?:\s?[257]\s?[.,]\s?[01])?|dd\s?[257][.,][01]|mp3|mp2|lpcm|pcm)\b/i

/** Reject declared encodes that the TV cannot decode; leave unknown codecs available. */
export function isTvVideoCompatible(stream: Stream, capabilities: TvVideoCapabilities = {}): boolean {
  const text = [stream.behaviorHints?.filename, stream.title, stream.description, stream.name].filter(Boolean).join(' ').replace(/[._]/g, ' ')
  // The TV platform this client targets stopped decoding DTS in-app with its 2018 models and has
  // never decoded TrueHD; a release whose only declared audio is one of those plays silently.
  const decodable = DECODABLE_AUDIO.test(text)
  if (!decodable && /\b(?:dts(?:[-:\s]?(?:hd|x|ma))?|truehd)\b/i.test(text)) return false
  if (!decodable && capabilities.opus === false && /\bopus\b/i.test(text)) return false
  if (!decodable && capabilities.flac === false && /\bflac\b/i.test(text)) return false
  const vision = /\b(?:dv|dovi|dolby\s*vision)\b/i.test(text)
  // Dolby Vision needs an explicit HDR10 base layer to be watchable on the DV-less TVs this
  // client targets: a bare "HDR" word beside "DV" is how single-layer profile-5 encodes are
  // usually labelled, and those render green/purple without DV decoding.
  const hdrBase = /\bhdr10\+?\b|\bhdr10plus\b/i.test(text)
  if (vision && !hdrBase) return false
  if (/\b(?:12[ -]?bit|yuv\s?444|4[: ]4[: ]4|hi444p)\b/i.test(text)) return false
  if (/\b(?:hi10p|hi10)\b/i.test(text) || /\b(?:h\s?264|x264|avc)\b/i.test(text) && /\b10[ -]?bit\b/i.test(text)) return false
  if (capabilities.hdr === false && (vision || hdrBase || /\bhlg\b/i.test(text))) return false
  if (capabilities.uhd === false && /\b(?:2160p?|4k|uhd)\b/i.test(text)) return false
  if (capabilities.av1 === false && /\bav1\b/i.test(text)) return false
  return true
}
