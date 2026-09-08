import type { Stream } from './parse'

/** Explicit extra markers are evidence; missing release metadata is not. */
export function isSupplementalVideo(stream: Stream, title = ''): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const identity = normalize(title)
  let path = ''
  try { path = decodeURIComponent(new URL(stream.url || '').pathname).split('/').pop() || '' } catch { /* Opaque URLs have no filename evidence. */ }
  return [stream.behaviorHints?.filename, stream.title, stream.description, stream.name, path].some(value => {
    if (!value) return false
    let text = normalize(value)
    if (identity) text = text.split(identity).join(' ')
    // tlr/tsr are the scene's own trailer/teaser abbreviations ("Title_TLR-2_4K…").
    return /\b(?:trailer|teaser|prologue|preview|sample|featurette|promo|behind the scenes|deleted scenes|making of|tlr\d*|tsr\d*)\b/.test(text)
  })
}

export interface TvVideoCapabilities { hdr?: boolean; uhd?: boolean; av1?: boolean }

/** Reject declared encodes that the TV cannot decode; leave unknown codecs available. */
export function isTvVideoCompatible(stream: Stream, capabilities: TvVideoCapabilities = {}): boolean {
  const text = [stream.behaviorHints?.filename, stream.title, stream.description, stream.name].filter(Boolean).join(' ').replace(/[._]/g, ' ')
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
