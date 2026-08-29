export type StreamingMotion = 'pulse' | 'arc' | 'wave' | 'bloom' | 'rise' | 'orbit'
export type StreamingBrandId =
  | 'netflix'
  | 'disney'
  | 'prime-video'
  | 'apple-tv'
  | 'hulu'
  | 'max'
  | 'crunchyroll'
  | 'paramount-plus'
  | 'peacock'
  | 'generic'

export interface StreamingBrand {
  id: StreamingBrandId
  primary: string
  secondary: string
  motion: StreamingMotion
  mark?: string
}
const GENERIC_BRAND: StreamingBrand = {
  id: 'generic',
  primary: '#4cc9f0',
  secondary: '#4361ee',
  motion: 'wave',
}

/** Visual accents are intentionally name-based: TMDB provider ids vary by region while the
 * service names remain recognizable. Unknown services receive the same polished neutral motion. */
export function streamingBrand(name: string): StreamingBrand {
  const value = name.toLowerCase()
  if (value.includes('netflix')) return { id: 'netflix', primary: '#e50914', secondary: '#350004', motion: 'pulse', mark: '/brand/streaming/netflix.svg' }
  if (value.includes('disney')) return { id: 'disney', primary: '#04d6c8', secondary: '#071b3d', motion: 'arc', mark: '/brand/streaming/disney-plus.svg' }
  if (value.includes('prime') || value.includes('amazon')) return { id: 'prime-video', primary: '#00a8e1', secondary: '#03273a', motion: 'wave', mark: '/brand/streaming/amazon-prime-video.svg' }
  if (value.includes('apple')) return { id: 'apple-tv', primary: '#f5f5f7', secondary: '#1e1e22', motion: 'bloom', mark: '/brand/streaming/apple-tv.svg' }
  if (value.includes('hulu')) return { id: 'hulu', primary: '#1ce783', secondary: '#06341e', motion: 'rise', mark: '/brand/streaming/hulu.svg' }
  if (value.includes('max') || value.includes('hbo')) return { id: 'max', primary: '#2f55ff', secondary: '#130846', motion: 'orbit', mark: '/brand/streaming/max.svg' }
  if (value.includes('crunchyroll')) return { id: 'crunchyroll', primary: '#f47521', secondary: '#3b1400', motion: 'orbit', mark: '/brand/streaming/crunchyroll.svg' }
  if (value.includes('paramount')) return { id: 'paramount-plus', primary: '#0064ff', secondary: '#061c51', motion: 'wave', mark: '/brand/streaming/paramount-plus.svg' }
  if (value.includes('peacock')) return { id: 'peacock', primary: '#ffd500', secondary: '#211a05', motion: 'pulse', mark: '/brand/streaming/peacock.svg' }
  return GENERIC_BRAND
}
