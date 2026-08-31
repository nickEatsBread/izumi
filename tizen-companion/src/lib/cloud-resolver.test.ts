import { describe, expect, it } from 'vitest'
import type { CompanionMedia } from '../types'
import { cloudResolveLoad, cloudResolveRequest, cloudResolveSelection } from './cloud-resolver'

const media: CompanionMedia = {
  ref: { provider: 'anilist', type: 'anime', id: '21' },
  resolver: { streamType: 'series' },
  title: 'One Piece',
  contentRating: 'TV-14',
  episode: 12,
  season: 1,
  episodeProgress: 0.5,
  episodeRuntimeMinutes: 24,
}

describe('private Worker source resolution', () => {
  it('sends only the media identity and non-secret resolver hint', () => {
    expect(cloudResolveRequest(media)).toEqual({
      ref: media.ref,
      episode: 12,
      season: 1,
      streamType: 'series',
    })
  })

  it('turns the selected source into a TV-local AVPlay request', () => {
    const load = cloudResolveLoad({
      ok: true,
      selectedId: 'preferred',
      candidates: [
        { id: 'other', url: 'https://cdn.example/other.mp4', subtitles: [] },
        {
          id: 'preferred',
          url: 'https://cdn.example/master.m3u8?token=private',
          contentType: 'application/vnd.apple.mpegurl',
          cookies: 'session=private',
          userAgent: 'Izumi TV',
          subtitles: [{ id: 'english', url: 'https://cdn.example/subtitles.vtt', lang: 'en' }],
        },
      ],
    }, media, 'request-id')

    expect(load).toMatchObject({
      sessionId: 'cloud-request-id-2',
      url: 'https://cdn.example/master.m3u8?token=private',
      title: 'One Piece',
      contentRating: 'TV-14',
      contentType: 'application/vnd.apple.mpegurl',
      positionSeconds: 720,
      activeTrackIds: [],
      cookies: 'session=private',
      userAgent: 'Izumi TV',
      subtitles: [{ id: 1, url: 'https://cdn.example/subtitles.vtt', lang: 'en', contentType: 'text/vtt' }],
    })
  })

  it('keeps the ranked Worker candidates available for in-player source switching', () => {
    const selection = cloudResolveSelection({
      ok: true,
      selectedId: '1080p',
      candidates: [
        {
          id: '1080p',
          url: 'https://video.example/1080.m3u8',
          title: 'SubsPlease release',
          quality: '1080p',
          source: 'Torrentio',
          badges: ['Cached', 'HEVC'],
        },
        { id: '720p', url: 'https://video.example/720.mp4', quality: '720p', source: 'MediaFusion' },
      ],
    }, media, 'source-menu')

    expect(selection).toMatchObject({
      selectedId: '1080p',
      request: { url: 'https://video.example/1080.m3u8' },
      sources: [
        { id: '1080p', label: 'SubsPlease release', detail: '1080p · Torrentio · Cached · HEVC' },
        { id: '720p', label: '720p', detail: 'MediaFusion' },
      ],
    })
    expect(selection?.sources[1].request.sessionId).toBe('cloud-source-menu-2')
  })

  it('rejects private-network sources and uses the next portable candidate', () => {
    expect(cloudResolveLoad({
      ok: true,
      selectedId: 'private',
      candidates: [
        { id: 'private', url: 'http://192.168.1.3/video.mp4' },
        { id: 'public', url: 'https://video.example/movie.mp4' },
      ],
    }, media, 'fallback')?.url).toBe('https://video.example/movie.mp4')
  })

  it('returns no load request when the Worker has no safe direct source', () => {
    expect(cloudResolveLoad({ ok: true, selectedId: null, candidates: [] }, media, 'empty')).toBeNull()
    expect(cloudResolveLoad({ ok: false, candidates: [{ id: 'x', url: 'https://video.example/x.mp4' }] }, media, 'failed')).toBeNull()
  })
})
