import { describe, expect, it } from 'vitest'
import { streamingBrand } from './streaming-brands'

describe('streaming service visual identity', () => {
  it('assigns recognizable accents and distinct motions to major services', () => {
    expect(streamingBrand('Netflix')).toMatchObject({ primary: '#e50914', motion: 'pulse' })
    expect(streamingBrand('Disney Plus')).toMatchObject({ primary: '#1f80e0', motion: 'arc' })
    expect(streamingBrand('Amazon Prime Video')).toMatchObject({ primary: '#00a8e1', motion: 'wave' })
    expect(streamingBrand('Apple TV Plus')).toMatchObject({ primary: '#f5f5f7', motion: 'bloom' })
    expect(streamingBrand('Hulu')).toMatchObject({ primary: '#1ce783', motion: 'rise' })
    expect(streamingBrand('Max')).toMatchObject({ primary: '#7b61ff', motion: 'orbit' })
  })

  it('uses a stable fallback for regional services', () => {
    expect(streamingBrand('A regional service')).toEqual(streamingBrand('Another regional service'))
  })
})
