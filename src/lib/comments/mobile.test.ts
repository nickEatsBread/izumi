import { describe, expect, it } from 'vitest'
import { decideEmbedGestureOwner, discussionBrowserUrl, embedResizeHeight, embedTouchScroll, EMBED_GESTURE_SLOP_PX, mobileEmbedSrc, preferredMobileDiscussion } from './mobile'
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

describe('discussionBrowserUrl', () => {
  it('uses the canonical page carried by a Disqus embed', () => {
    const canonical = 'https://comments.example/episode/1'
    const embedUrl = `https://disqus.com/embed/comments/?f=anime&t_u=${encodeURIComponent(canonical)}`
    expect(discussionBrowserUrl(thread('Disqus', { embedUrl }))).toBe(canonical)
  })

  it('prefers an explicit HTTPS thread URL', () => {
    expect(discussionBrowserUrl(thread('Disqus', {
      url: 'https://comments.example/thread',
      embedUrl: 'https://disqus.com/embed/comments/?t_u=https%3A%2F%2Ffallback.example',
    }))).toBe('https://comments.example/thread')
  })

  it('never hands an unsafe URL to the system browser', () => {
    expect(discussionBrowserUrl(thread('Disqus', {
      url: 'javascript:alert(1)',
      embedUrl: 'https://disqus.com/embed/comments/?t_u=http%3A%2F%2Finsecure.example',
    }))).toBeNull()
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

describe('embedTouchScroll', () => {
  const APP = 'http://tauri.localhost'

  it('accepts bounded drag phases from the same-origin loader', () => {
    expect(embedTouchScroll(APP, { type: 'izumi-disqus-page-scroll', phase: 'start' }, APP))
      .toEqual({ phase: 'start', dy: 0, dt: 0, cancelable: true })
    expect(embedTouchScroll(APP, { type: 'izumi-disqus-page-scroll', phase: 'move', dy: 24, dt: 12 }, APP))
      .toEqual({ phase: 'move', dy: 24, dt: 12, cancelable: true })
    expect(embedTouchScroll(APP, { type: 'izumi-disqus-page-scroll', phase: 'end' }, APP))
      .toEqual({ phase: 'end', dy: 0, dt: 0, cancelable: true })
  })

  it('rejects foreign, malformed, and unbounded drag messages', () => {
    expect(embedTouchScroll('https://evil.example', { type: 'izumi-disqus-page-scroll', phase: 'move', dy: 10, dt: 10 }, APP)).toBeNull()
    expect(embedTouchScroll(APP, { type: 'izumi-disqus-page-scroll', phase: 'move', dy: 301, dt: 10 }, APP)).toBeNull()
    expect(embedTouchScroll(APP, { type: 'izumi-disqus-page-scroll', phase: 'move', dy: 10, dt: 0 }, APP)).toBeNull()
    expect(embedTouchScroll(APP, { type: 'izumi-disqus-page-scroll', phase: 'sideways', dy: 10, dt: 10 }, APP)).toBeNull()
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

describe('decideEmbedGestureOwner', () => {
  type Gesture = ReturnType<typeof decideEmbedGestureOwner>
  const idle: Gesture = { owner: 'undecided', pending: 0, armed: false }
  const middle = { scrollTop: 400, startTop: 400, scrollHeight: 4000, clientHeight: 800 }
  const run = (moves: { dy: number; cancelable: boolean }[], scroller = middle) =>
    moves.reduce<Gesture>((state, move) => decideEmbedGestureOwner(state, move, scroller), idle)

  it('leaves a gesture the browser is scrolling alone', () => {
    expect(run([{ dy: 6, cancelable: true }, { dy: 20, cancelable: false }]).owner).toBe('native')
    // The scroller moving under the finger says the same thing.
    expect(run([{ dy: 6, cancelable: true }, { dy: 20, cancelable: true }], { ...middle, scrollTop: 412 }).owner).toBe('native')
  })

  it('takes over only once a second cancelable move has cleared the slop with nothing moving', () => {
    const first = decideEmbedGestureOwner(idle, { dy: 40, cancelable: true }, middle)
    // One fast move past the slop is the move that starts a native scroll; not proof of anything.
    expect(first).toMatchObject({ owner: 'undecided', armed: true })
    const second = decideEmbedGestureOwner(first, { dy: 8, cancelable: true }, middle)
    expect(second).toMatchObject({ owner: 'page', pending: 48 })
  })

  it('does not decide on travel short of the slop', () => {
    const state = run([{ dy: 4, cancelable: true }, { dy: 4, cancelable: true }, { dy: 3, cancelable: true }])
    expect(state.owner).toBe('undecided')
    expect(state.pending).toBeLessThan(EMBED_GESTURE_SLOP_PX)
  })

  it('learns nothing at an edge and hands the gesture back to the browser', () => {
    const top = { scrollTop: 0, startTop: 0, scrollHeight: 4000, clientHeight: 800 }
    expect(run([{ dy: -20, cancelable: true }, { dy: -10, cancelable: true }], top).owner).toBe('native')
    expect(run([{ dy: 20, cancelable: true }, { dy: 10, cancelable: true }], top).owner).toBe('page')
    const bottom = { scrollTop: 3200, startTop: 3200, scrollHeight: 4000, clientHeight: 800 }
    expect(run([{ dy: 20, cancelable: true }, { dy: 10, cancelable: true }], bottom).owner).toBe('native')
  })

  it('never reopens a decided gesture', () => {
    const page: Gesture = { owner: 'page', pending: 30, armed: true }
    expect(decideEmbedGestureOwner(page, { dy: 5, cancelable: false }, middle)).toBe(page)
  })
})

describe('embedTouchScroll cancelable flag', () => {
  const APP = 'https://izumi.invalid'
  it('reads an uncancelable move as the browser owning the scroll', () => {
    expect(embedTouchScroll(APP, { type: 'izumi-disqus-page-scroll', phase: 'move', dy: 3, dt: 8, cancelable: false }, APP))
      .toEqual({ phase: 'move', dy: 3, dt: 8, cancelable: false })
    expect(embedTouchScroll(APP, { type: 'izumi-disqus-page-scroll', phase: 'move', dy: 3, dt: 8 }, APP)?.cancelable).toBe(true)
  })
})
