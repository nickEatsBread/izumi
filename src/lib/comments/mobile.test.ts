import { describe, expect, it } from 'vitest'
import {
  disqusForum,
  disqusLoginUrl,
  mobileEmbedSrc,
  preferredMobileDiscussion,
  reloadedEmbedSrc,
} from './mobile'
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

describe('mobileEmbedSrc', () => {
  it('routes a Disqus inner iframe through the local loader', () => {
    expect(mobileEmbedSrc('https://disqus.com/embed/comments/?f=anime&t_i=ep-1&t_t=Title'))
      .toBe('/disqus-embed.html?f=anime&t_i=ep-1&t_t=Title')
  })
})

describe('mobile Disqus login', () => {
  const embed = '/disqus-embed.html?f=anime-forum&t_i=ep-1'

  it('builds the documented forum login URL', () => {
    expect(disqusForum(embed)).toBe('anime-forum')
    expect(disqusLoginUrl(embed)).toBe('https://disqus.com/next/login/?forum=anime-forum')
  })

  it('rejects invalid forum shortnames', () => {
    expect(disqusLoginUrl('/disqus-embed.html?f=not%20valid')).toBeNull()
  })

  it('cache-busts the local iframe after authentication', () => {
    expect(reloadedEmbedSrc(embed, 2)).toBe('/disqus-embed.html?f=anime-forum&t_i=ep-1&izumi_login=2')
  })
})
