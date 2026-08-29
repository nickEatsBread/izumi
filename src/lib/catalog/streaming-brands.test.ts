import { describe, expect, it } from 'vitest'
import { orderStreamingServices, streamingBrand } from './streaming-brands'

describe('streaming service visual identity', () => {
  it('assigns recognizable accents and bundled marks to major services', () => {
    expect(streamingBrand('Netflix')).toMatchObject({ id: 'netflix', primary: '#e50914', mark: '/brand/streaming/netflix.svg' })
    expect(streamingBrand('Disney Plus')).toMatchObject({ id: 'disney', primary: '#04d6c8', mark: '/brand/streaming/disney-plus.svg' })
    expect(streamingBrand('Amazon Prime Video')).toMatchObject({ id: 'prime-video', primary: '#00a8e1', mark: '/brand/streaming/amazon-prime-video.svg' })
    expect(streamingBrand('Apple TV Plus')).toMatchObject({ id: 'apple-tv', primary: '#f5f5f7', secondary: '#242a38', mark: '/brand/streaming/apple-tv.svg' })
    expect(streamingBrand('Hulu')).toMatchObject({ id: 'hulu', primary: '#1ce783', mark: '/brand/streaming/hulu.svg' })
    expect(streamingBrand('Max')).toMatchObject({ id: 'max', primary: '#2f55ff', mark: '/brand/streaming/max.svg' })
  })

  it('recognizes supplied regional service artwork', () => {
    expect(streamingBrand('Google Play Movies')).toMatchObject({ id: 'google-play', mark: '/brand/streaming/google-play.png' })
    expect(streamingBrand('FilmBox+')).toMatchObject({ id: 'filmbox-plus', mark: '/brand/streaming/filmbox-plus.png' })
    expect(streamingBrand('Sun NXT')).toMatchObject({ id: 'sun-nxt', mark: '/brand/streaming/sun-nxt.png' })
  })

  it('keeps the primary services ordered and collapses Apple store variants', () => {
    const ordered = orderStreamingServices([
      { title: 'A regional service' },
      { title: 'Apple TV' },
      { title: 'Crunchyroll' },
      { title: 'Prime Video' },
      { title: 'Netflix' },
      { title: 'Peacock' },
      { title: 'Disney+' },
      { title: 'Apple TV Plus' },
      { title: 'Max' },
      { title: 'Hulu' },
      { title: 'Paramount Plus' },
      { title: 'Another regional service' },
    ])

    expect(ordered.map((service) => service.title)).toEqual([
      'Netflix', 'Disney+', 'Hulu', 'Prime Video', 'Apple TV Plus', 'Max',
      'Paramount Plus', 'Peacock', 'Crunchyroll',
      'A regional service', 'Another regional service',
    ])
  })

  it('uses a stable fallback for regional services', () => {
    expect(streamingBrand('A regional service')).toEqual(streamingBrand('Another regional service'))
    expect(streamingBrand('A regional service')).toMatchObject({ id: 'generic' })
    expect(streamingBrand('A regional service').mark).toBeUndefined()
  })
})
