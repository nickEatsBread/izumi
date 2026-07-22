import { describe, expect, it } from 'vitest'
import { mobileEmbedSrc, preferredMobileDiscussion } from './mobile'
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
