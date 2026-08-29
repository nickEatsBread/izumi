export type StreamingMotion = 'pulse' | 'arc' | 'wave' | 'bloom' | 'rise' | 'orbit'

export interface StreamingBrand {
  primary: string
  secondary: string
  motion: StreamingMotion
}
const GENERIC_BRAND: StreamingBrand = {
  primary: '#4cc9f0',
  secondary: '#4361ee',
  motion: 'wave',
}

/** Visual accents are intentionally name-based: TMDB provider ids vary by region while the
 * service names remain recognizable. Unknown services receive the same polished neutral motion. */
export function streamingBrand(name: string): StreamingBrand {
  const value = name.toLowerCase()
  if (value.includes('netflix')) return { primary: '#e50914', secondary: '#6f0007', motion: 'pulse' }
  if (value.includes('disney')) return { primary: '#1f80e0', secondary: '#071f5d', motion: 'arc' }
  if (value.includes('prime') || value.includes('amazon')) return { primary: '#00a8e1', secondary: '#00668a', motion: 'wave' }
  if (value.includes('apple')) return { primary: '#f5f5f7', secondary: '#77777d', motion: 'bloom' }
  if (value.includes('hulu')) return { primary: '#1ce783', secondary: '#07552f', motion: 'rise' }
  if (value.includes('max') || value.includes('hbo')) return { primary: '#7b61ff', secondary: '#34216f', motion: 'orbit' }
  if (value.includes('crunchyroll')) return { primary: '#f47521', secondary: '#7a2500', motion: 'orbit' }
  if (value.includes('paramount')) return { primary: '#0064ff', secondary: '#082369', motion: 'wave' }
  if (value.includes('peacock')) return { primary: '#ffd500', secondary: '#7a5700', motion: 'pulse' }
  return GENERIC_BRAND
}
