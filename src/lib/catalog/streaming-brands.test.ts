import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { orderStreamingServices, populateStreamingServices, streamingBrand } from './streaming-brands'

const PRIMARY_SERVICES = [
  { name: 'Netflix', id: 'netflix', mark: '/brand/streaming/netflix.svg' },
  { name: 'Disney+', id: 'disney', mark: '/brand/streaming/disney-plus.svg' },
  { name: 'Hulu', id: 'hulu', mark: '/brand/streaming/hulu.svg' },
  { name: 'Prime Video', id: 'prime-video', mark: '/brand/streaming/amazon-prime-video.svg' },
  { name: 'Apple TV Plus', id: 'apple-tv', mark: '/brand/streaming/apple-tv.svg' },
  { name: 'Max', id: 'max', mark: '/brand/streaming/max.svg' },
  { name: 'Paramount Plus', id: 'paramount-plus', mark: '/brand/streaming/paramount-plus.svg' },
  { name: 'Peacock', id: 'peacock', mark: '/brand/streaming/peacock.svg' },
  { name: 'Crunchyroll', id: 'crunchyroll', mark: '/brand/streaming/crunchyroll.svg' },
] as const

describe('streaming service visual identity', () => {
  it('assigns recognizable accents and bundled marks to major services', () => {
    for (const service of PRIMARY_SERVICES) {
      expect(streamingBrand(service.name)).toMatchObject({ id: service.id, mark: service.mark })
    }
    expect(streamingBrand('Apple TV Plus')).toMatchObject({ primary: '#f5f5f7', secondary: '#242a38' })
    expect(streamingBrand('Max').preview).toBeUndefined()
  })

  it('ships every primary service icon in the static bundle', () => {
    for (const service of PRIMARY_SERVICES) {
      const path = fileURLToPath(new URL(`../../../static${service.mark}`, import.meta.url))
      expect(existsSync(path)).toBe(true)
      expect(statSync(path).size).toBeGreaterThan(0)
    }
  })

  it('recognizes supplied regional service artwork', () => {
    expect(streamingBrand('Google Play Movies')).toMatchObject({ id: 'google-play', mark: '/brand/streaming/google-play.png' })
    expect(streamingBrand('FilmBox+')).toMatchObject({ id: 'filmbox-plus', mark: '/brand/streaming/filmbox-plus.png' })
    expect(streamingBrand('Sun NXT')).toMatchObject({ id: 'sun-nxt', mark: '/brand/streaming/sun-nxt.png' })
  })

  it('ships every assigned regional icon in the static bundle', () => {
    for (const name of ['Google Play Movies', 'FilmBox+', 'Sun NXT']) {
      const mark = streamingBrand(name).mark
      expect(mark).toBeDefined()
      expect(existsSync(fileURLToPath(new URL(`../../../static${mark}`, import.meta.url)))).toBe(true)
    }
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

  it('populates missing primary cards before regional services', () => {
    const populated = populateStreamingServices([
      { id: '8', title: 'Netflix', href: '/live-netflix' },
      { id: '337', title: 'Disney Plus', href: '/live-disney' },
      { id: '9', title: 'Prime Video', href: '/live-prime' },
      { id: '2', title: 'Apple TV Store', href: '/store' },
      { id: '3', title: 'Google Play Movies', href: '/google' },
    ])

    expect(populated.slice(0, 9).map((service) => streamingBrand(service.title).id)).toEqual([
      'netflix', 'disney', 'hulu', 'prime-video', 'apple-tv', 'max',
      'paramount-plus', 'peacock', 'crunchyroll',
    ])
    expect(populated[9]).toMatchObject({ title: 'Google Play Movies', href: '/google' })
    expect(populated.some((service) => service.title === 'Apple TV Store')).toBe(false)
  })

  it('uses a stable fallback for regional services', () => {
    expect(streamingBrand('A regional service')).toEqual(streamingBrand('Another regional service'))
    expect(streamingBrand('A regional service')).toMatchObject({ id: 'generic' })
    expect(streamingBrand('A regional service').mark).toBeUndefined()
  })
})
