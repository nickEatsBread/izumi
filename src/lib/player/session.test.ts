import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import { onlineSubCandidates, subtitleNotice, torrentSubtitleState } from './session'

describe('subtitle session stores', () => {
  it('onlineSubCandidates defaults to idle with no items', () => {
    expect(get(onlineSubCandidates)).toEqual({ status: 'idle', items: [] })
  })
  it('subtitleNotice defaults to an empty string', () => {
    expect(get(subtitleNotice)).toBe('')
  })
  it('torrentSubtitleState defaults to idle with no pending tracks', () => {
    expect(get(torrentSubtitleState)).toEqual({
      playbackId: null,
      status: 'idle',
      loaded: 0,
      total: 0,
      revision: 0,
    })
  })
})
