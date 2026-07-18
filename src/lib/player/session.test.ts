import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import { onlineSubCandidates, subtitleNotice } from './session'

describe('subtitle session stores', () => {
  it('onlineSubCandidates defaults to idle with no items', () => {
    expect(get(onlineSubCandidates)).toEqual({ status: 'idle', items: [] })
  })
  it('subtitleNotice defaults to an empty string', () => {
    expect(get(subtitleNotice)).toBe('')
  })
})
