import { beforeEach, describe, expect, it, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: httpFetch }))

import { fetchMediaById } from './fetch-media'

describe('fetchMediaById', () => {
  beforeEach(() => httpFetch.mockReset())

  it('refreshes the source-resolution fields omitted by persisted history snapshots', async () => {
    const media = { id: 987654, title: { userPreferred: 'Fresh title' }, synonyms: ['Alias'] }
    httpFetch.mockResolvedValue({ json: async () => ({ data: { Media: media } }) })

    await expect(fetchMediaById(media.id)).resolves.toBe(media)

    const [url, init] = httpFetch.mock.calls[0]
    expect(url).toBe('https://graphql.anilist.co')
    const body = JSON.parse(init.body) as { query: string; variables: { id: number } }
    const query = body.query.replace(/\s+/g, ' ')
    expect(body.variables.id).toBe(media.id)
    expect(query).toContain('season seasonYear')
    expect(query).toContain('genres synonyms')
    expect(query).toContain('startDate{year month day}')
    expect(query).toContain('studios(isMain:true)')
  })
})
