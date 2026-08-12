import { describe, expect, it } from 'vitest'
import { embedResizeHeight, mobileEmbedSrc, preferredMobileDiscussion } from './mobile'
import type { DiscussionThread } from './types'

const thread = (source: string, extra: Partial<DiscussionThread> = {}): DiscussionThread => ({
  id: source, source, title: source, ...extra,
})

describe('preferredMobileDiscussion', () => {
  it('prefers an embeddable Disqus thread over Reddit', () => {
    const result = preferredMobileDiscussion([
      thread('Reddit', { comments: [{ id: '1', source: 'Reddit', body: 'Hi' }] }),
      thread('Disqus', { embedUrl: 'https://disqus.com/embed/comments/?f=anime&t_i=ep-1' }),
    ])
    expect(result?.kind).toBe('disqus')
  })

  it('falls back to Reddit comments', () => {
    expect(preferredMobileDiscussion([
      thread('Reddit', { comments: [{ id: '1', source: 'Reddit', body: 'Hi' }] }),
    ])?.kind).toBe('reddit')
  })

  it('returns nothing when neither source has renderable comments', () => {
    expect(preferredMobileDiscussion([thread('Reddit'), thread('AniList')])).toBeNull()
  })
})

describe('embedResizeHeight', () => {
  const APP = 'http://tauri.localhost'

  it('accepts the loader height message from the app origin', () => {
    expect(embedResizeHeight(APP, { type: 'izumi-disqus-height', height: 1234.4 }, APP)).toBe(1235)
  })

  it('rejects the loader height message from any other origin', () => {
    expect(embedResizeHeight('https://evil.example', { type: 'izumi-disqus-height', height: 1234 }, APP)).toBeNull()
  })

  it('accepts the archive resize message from discussanime.moe', () => {
    expect(embedResizeHeight('https://discussanime.moe', { type: 'discussanime-archive-embed:resize', height: 8000 }, APP)).toBe(8000)
  })

  it('rejects the archive resize message from any other origin', () => {
    expect(embedResizeHeight(APP, { type: 'discussanime-archive-embed:resize', height: 8000 }, APP)).toBeNull()
    expect(embedResizeHeight('https://discussanime.moe.evil.example', { type: 'discussanime-archive-embed:resize', height: 8000 }, APP)).toBeNull()
  })

  it('clamps to the 480..100000 range', () => {
    expect(embedResizeHeight(APP, { type: 'izumi-disqus-height', height: 12 }, APP)).toBe(480)
    expect(embedResizeHeight('https://discussanime.moe', { type: 'discussanime-archive-embed:resize', height: 250_000 }, APP)).toBe(100_000)
  })

  it('ignores non-height messages and unusable heights', () => {
    expect(embedResizeHeight(APP, { type: 'izumi-react', height: 900 }, APP)).toBeNull()
    expect(embedResizeHeight(APP, null, APP)).toBeNull()
    expect(embedResizeHeight(APP, { type: 'izumi-disqus-height', height: 'tall' }, APP)).toBeNull()
    expect(embedResizeHeight(APP, { type: 'izumi-disqus-height', height: Number.NaN }, APP)).toBeNull()
    expect(embedResizeHeight(APP, { type: 'izumi-disqus-height', height: 0 }, APP)).toBeNull()
    expect(embedResizeHeight(APP, { type: 'izumi-disqus-height' }, APP)).toBeNull()
  })
})

describe('mobileEmbedSrc', () => {
  it('routes a Disqus inner iframe through the local loader', () => {
    expect(mobileEmbedSrc('https://disqus.com/embed/comments/?f=anime&t_i=ep-1&t_t=Title'))
      .toBe('/disqus-embed.html?f=anime&t_i=ep-1&t_t=Title&izumi_expand=1')
  })

  it('enables expanded scrolling for an existing local loader URL', () => {
    expect(mobileEmbedSrc('/disqus-embed.html?f=anime&t_i=ep-1'))
      .toBe('/disqus-embed.html?f=anime&t_i=ep-1&izumi_expand=1')
  })

  it('leaves a DiscussAnime archive URL for the official theme bridge', () => {
    expect(mobileEmbedSrc('https://discussanime.moe/embed/discussion/episode-1'))
      .toBe('https://discussanime.moe/embed/discussion/episode-1')
  })
})
