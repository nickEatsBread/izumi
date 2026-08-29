export type StreamingBrandId =
  | 'netflix'
  | 'disney'
  | 'prime-video'
  | 'apple-tv'
  | 'google-play'
  | 'filmbox-plus'
  | 'sun-nxt'
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
  mark?: string
  /** Optional remote artwork is requested only when a tile is hovered or focused. */
  preview?: string
  previewPosition?: string
}
const GENERIC_BRAND: StreamingBrand = {
  id: 'generic',
  primary: '#4cc9f0',
  secondary: '#4361ee',
}

/** Provider ids vary by region, while service names and marks remain recognizable. Known services
 * use bundled vector marks; every other service falls back to the live provider artwork. */
export function streamingBrand(name: string): StreamingBrand {
  const value = name.toLowerCase()
  if (value.includes('netflix')) return {
    id: 'netflix', primary: '#e50914', secondary: '#17090b', mark: '/brand/streaming/netflix.svg',
    preview: 'https://images.ctfassets.net/jlq9bsvx8e5q/56Z53teFsuL2B4DPItHj5b/9f40118e6590cd4776e8ae0f81d71e70/ident_178.gif',
  }
  if (value.includes('disney')) return {
    id: 'disney', primary: '#04d6c8', secondary: '#071b3d', mark: '/brand/streaming/disney-plus.svg',
    preview: 'https://s1.eestatic.com/2018/08/09/actualidad/actualidad_328981097_130271776_1706x960.jpg',
    previewPosition: 'center 54%',
  }
  if (value.includes('prime') || value.includes('amazon')) return {
    id: 'prime-video', primary: '#00a8e1', secondary: '#082130', mark: '/brand/streaming/amazon-prime-video.svg',
    preview: 'https://i.vimeocdn.com/video/1648130147-cac56007388a091bb59cc5f8b2da4dd4e1ee4a07deba61602287c010eacabf87-d?f=webp',
  }
  if (value.includes('apple')) return {
    id: 'apple-tv', primary: '#f5f5f7', secondary: '#242a38', mark: '/brand/streaming/apple-tv.svg',
    preview: 'https://tvark.org/media/2023/07/Apple_TV_Plus_Ident_a.jpg',
  }
  if (value.includes('google play')) return {
    id: 'google-play', primary: '#34a853', secondary: '#151d29', mark: '/brand/streaming/google-play.png',
  }
  if (value.includes('filmbox') || value.includes('film box')) return {
    id: 'filmbox-plus', primary: '#f21b27', secondary: '#e9eaed', mark: '/brand/streaming/filmbox-plus.png',
  }
  if (value.includes('sun nxt') || value.includes('sunnxt') || value.includes('sun next')) return {
    id: 'sun-nxt', primary: '#ef3155', secondary: '#2a0a18', mark: '/brand/streaming/sun-nxt.png',
  }
  if (value.includes('hulu')) return {
    id: 'hulu', primary: '#1ce783', secondary: '#092118', mark: '/brand/streaming/hulu.svg',
    preview: 'https://www.datocms-assets.com/160962/1756372927-hulu_thumbnail.webp?auto=format&fit=max&w=1200',
  }
  if (value.includes('max') || value.includes('hbo')) return {
    id: 'max', primary: '#2f55ff', secondary: '#10132b', mark: '/brand/streaming/max.svg',
    preview: 'https://cdn.mos.cms.futurecdn.net/XXNTh2LJ7Kawpa6fk4Vdki.jpg',
  }
  if (value.includes('crunchyroll')) return { id: 'crunchyroll', primary: '#f47521', secondary: '#24140a', mark: '/brand/streaming/crunchyroll.svg' }
  if (value.includes('paramount')) return { id: 'paramount-plus', primary: '#0064ff', secondary: '#10182a', mark: '/brand/streaming/paramount-plus.svg' }
  if (value.includes('peacock')) return { id: 'peacock', primary: '#ffd500', secondary: '#211e16', mark: '/brand/streaming/peacock.svg' }
  return GENERIC_BRAND
}
