import { describe, expect, it } from 'vitest'
import { streamingBrand } from './streaming-brands'

describe('streaming service visual identity', () => {
  it('assigns recognizable accents and distinct motions to major services', () => {
    expect(streamingBrand('Netflix')).toMatchObject({ id: 'netflix', primary: '#e50914', motion: 'pulse', mark: '/brand/streaming/netflix.svg' })
    expect(streamingBrand('Disney Plus')).toMatchObject({ id: 'disney', primary: '#04d6c8', motion: 'arc', mark: '/brand/streaming/disney-plus.svg' })
    expect(streamingBrand('Amazon Prime Video')).toMatchObject({ id: 'prime-video', primary: '#00a8e1', motion: 'wave', mark: '/brand/streaming/amazon-prime-video.svg' })
    expect(streamingBrand('Apple TV Plus')).toMatchObject({ id: 'apple-tv', primary: '#f5f5f7', motion: 'bloom', mark: '/brand/streaming/apple-tv.svg' })
    expect(streamingBrand('Hulu')).toMatchObject({ id: 'hulu', primary: '#1ce783', motion: 'rise', mark: '/brand/streaming/hulu.svg' })
    expect(streamingBrand('Max')).toMatchObject({ id: 'max', primary: '#2f55ff', motion: 'orbit', mark: '/brand/streaming/max.svg' })
  })

  it('uses a stable fallback for regional services', () => {
    expect(streamingBrand('A regional service')).toEqual(streamingBrand('Another regional service'))
    expect(streamingBrand('A regional service')).toMatchObject({ id: 'generic' })
    expect(streamingBrand('A regional service').mark).toBeUndefined()
  })
})
