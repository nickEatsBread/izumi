import { describe, expect, it } from 'vitest'
import type { Stream } from '$lib/stremio/addon'
import { audioCounterpart, serverSiblings, variantLabel } from './source-variants'

// Minimal online-provider row shaped like videoSourceToStream's real output (onlinestream.ts):
// `name` follows its "⚡ Provider · Server · quality" convention, __stream marks a direct source,
// __origin identifies the site, __audio/__server/__quality the flavour/extractor/quality being
// swapped between. __quality carries the provider's OWN quality string — never re-parsed out of
// `name`, which is exactly the bug this module has to avoid (a server token like "HD-1" would
// otherwise satisfy resolutionOf's `\bhd\b` branch and fabricate a quality that was never reported).
const row = (over: Partial<Stream> = {}): Stream => ({
  url: 'https://example.com/video.mp4',
  name: '⚡ ProviderOne · HD-1 · 1080p',
  __stream: true,
  __origin: { kind: 'online-extension', id: 'provider-1', name: 'ProviderOne' },
  __addonName: 'ProviderOne',
  __audio: 'sub',
  __server: 'HD-1',
  __quality: '1080p',
  ...over,
})

describe('audioCounterpart', () => {
  it('finds the other flavour on the same provider, preferring the same server', () => {
    const current = row()
    const other = row({
      __audio: 'dub', __server: 'HD-2', url: 'https://example.com/other.mp4',
      name: '⚡ ProviderOne · HD-2 · 1080p',
    })
    const same = row({
      __audio: 'dub', __server: 'HD-1', url: 'https://example.com/same.mp4',
      name: '⚡ ProviderOne · HD-1 · 1080p',
    })
    expect(audioCounterpart(current, [current, other, same])).toBe(same)
  })

  it('falls back to same quality, then any, when no same-server counterpart exists', () => {
    const current = row({ __server: 'HD-1', __quality: '1080p' })
    const sameQuality = row({
      __audio: 'dub', __server: 'HD-2', __quality: '1080p', url: 'https://example.com/sq.mp4',
      name: '⚡ ProviderOne · HD-2 · 1080p',
    })
    const otherQuality = row({
      __audio: 'dub', __server: 'HD-3', __quality: '720p', url: 'https://example.com/oq.mp4',
      name: '⚡ ProviderOne · HD-3 · 720p',
    })
    expect(audioCounterpart(current, [current, otherQuality, sameQuality])).toBe(sameQuality)

    // No same-server, no same-quality candidate → falls back to any dub row on the provider.
    const anyDub = row({
      __audio: 'dub', __server: 'HD-9', __quality: '480p', url: 'https://example.com/any.mp4',
      name: '⚡ ProviderOne · HD-9 · 480p',
    })
    expect(audioCounterpart(current, [current, anyDub])).toBe(anyDub)
  })

  it('returns undefined off-provider, for torrent rows, and when current has no audio tag', () => {
    const current = row()
    const offProvider = row({
      __audio: 'dub', __origin: { kind: 'online-extension', id: 'provider-2', name: 'ProviderTwo' },
      __addonName: 'ProviderTwo', url: 'https://other-site.com/video.mp4',
      name: '⚡ ProviderTwo · HD-1 · 1080p',
    })
    expect(audioCounterpart(current, [current, offProvider])).toBeUndefined()

    const torrentRow: Stream = {
      infoHash: 'abc123', name: '[Group] Show - 01 (1080p)', __audio: 'dub',
    }
    expect(audioCounterpart(torrentRow, [torrentRow, offProvider])).toBeUndefined()

    const noAudioTag = row({ __audio: undefined })
    const dub = row({ __audio: 'dub', url: 'https://example.com/dub.mp4' })
    expect(audioCounterpart(noAudioTag, [noAudioTag, dub])).toBeUndefined()
  })

  it('skips a candidate with no resolved url', () => {
    const current = row()
    const noUrl = row({ __audio: 'dub', __server: 'HD-1', url: undefined })
    const withUrl = row({
      __audio: 'dub', __server: 'HD-2', url: 'https://example.com/withurl.mp4',
      name: '⚡ ProviderOne · HD-2 · 1080p',
    })
    expect(audioCounterpart(current, [current, noUrl, withUrl])).toBe(withUrl)
  })

  it('falls back to __addonName for provider identity when __origin is absent', () => {
    const current = row({ __origin: undefined })
    const same = row({
      __audio: 'dub', __origin: undefined, __addonName: 'ProviderOne',
      url: 'https://example.com/same.mp4', name: '⚡ ProviderOne · HD-1 · 1080p',
    })
    const different = row({
      __audio: 'dub', __origin: undefined, __addonName: 'ProviderTwo',
      url: 'https://example.com/diff.mp4', name: '⚡ ProviderTwo · HD-1 · 1080p',
    })
    expect(audioCounterpart(current, [current, different, same])).toBe(same)
  })

  it('regression: an "auto" __quality is unknown, not a fabricated match off an HD-N server token', () => {
    // Reproduces the bug where resolutionOf greps the whole display name: current's own name
    // contains "HD-9" and would satisfy `\b720p?\b|\bhd\b`, so a heuristic-only quality() read it
    // as 720p even though the provider explicitly said "auto" (unknown). `other2`'s name has the
    // same "HD" pollution and would falsely tie with that fabricated 720p, jumping the quality
    // tier ahead of `other1` — which has no "hd" substring in its server name and genuinely reports
    // 480p, a real (if different) quality. With __quality respected, current's quality is unknown,
    // no quality-tier match is possible, and the pick falls through to "any" — other1, first in
    // the pool — instead of the falsely-tied other2.
    const current = row({ __server: 'HD-9', __quality: 'auto', name: '⚡ ProviderOne · HD-9 · auto' })
    const other1 = row({
      __audio: 'dub', __server: 'SD-1', __quality: '480p', url: 'https://example.com/o1.mp4',
      name: '⚡ ProviderOne · SD-1 · 480p',
    })
    const other2 = row({
      __audio: 'dub', __server: 'HD-2', __quality: '480p', url: 'https://example.com/o2.mp4',
      name: '⚡ ProviderOne · HD-2 · 480p',
    })
    expect(audioCounterpart(current, [current, other1, other2])).toBe(other1)
  })
})

describe('serverSiblings', () => {
  it('lists same-provider same-audio rows excluding the current one and other flavours', () => {
    const current = row()
    const sibling = row({ __server: 'HD-2', url: 'https://example.com/hd2.mp4', name: '⚡ ProviderOne · HD-2 · 1080p' })
    const dub = row({ __audio: 'dub', url: 'https://example.com/dub.mp4' })
    const offProvider = row({
      __origin: { kind: 'online-extension', id: 'provider-2', name: 'ProviderTwo' },
      __addonName: 'ProviderTwo', url: 'https://other-site.com/video.mp4', name: '⚡ ProviderTwo · HD-1 · 1080p',
    })
    const duplicateUrl = row({ __server: 'HD-3', url: current.url })

    const siblings = serverSiblings(current, [current, sibling, dub, offProvider, duplicateUrl])
    expect(siblings).toEqual([sibling])
  })

  it('returns [] for torrent/debrid rows', () => {
    const torrentRow: Stream = {
      infoHash: 'abc123', name: '[Group] Show - 01 (1080p)', __audio: 'sub',
    }
    const other: Stream = { infoHash: 'def456', name: '[Group] Show - 01 (720p)', __audio: 'sub' }
    expect(serverSiblings(torrentRow, [torrentRow, other])).toEqual([])
  })
})

describe('variantLabel', () => {
  it('renders server · quality, hides a "default" server, falls back to name', () => {
    const withServer = row({ __server: 'HD-2', __quality: '1080p', name: '⚡ ProviderOne · HD-2 · 1080p' })
    expect(variantLabel(withServer)).toBe('HD-2 · 1080p')

    const defaultServer = row({ __server: 'default', __quality: '1080p', name: '⚡ ProviderOne · 1080p' })
    expect(variantLabel(defaultServer)).toBe('1080p')

    const noServerNoQuality = row({ __server: undefined, __quality: undefined, name: 'ProviderOne stream' })
    expect(variantLabel(noServerNoQuality)).toBe('ProviderOne stream')
  })

  it('regression: an "auto" __quality renders the server with NO quality suffix', () => {
    // Same HD-token trap as above: "HD-1" in the name must not resurrect a fabricated "· 720p".
    const autoQuality = row({ __server: 'HD-1', __quality: 'auto', name: '⚡ ProviderOne · HD-1 · auto' })
    expect(variantLabel(autoQuality)).toBe('HD-1')
  })
})
