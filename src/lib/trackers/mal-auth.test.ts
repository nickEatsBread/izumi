import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const mocks = vi.hoisted(() => ({ malHttpFetch: vi.fn() }))

vi.mock('./mal-http', () => ({ malHttpFetch: mocks.malHttpFetch }))
vi.mock('./oauth', () => ({ captureLogin: vi.fn(), redirectUri: 'https://client.izumi.watch/callback' }))

import { refreshMal } from './mal-auth'
import { malRefresh, malToken, malTokenExpiry, malUserAvatar, malUserName } from './config'

describe('MAL token refresh', () => {
  beforeEach(() => {
    mocks.malHttpFetch.mockReset()
    malToken.set('access-old')
    malRefresh.set('refresh-old')
    malTokenExpiry.set(123)
    malUserName.set('viewer')
    malUserAvatar.set('avatar')
  })

  it.each([429, 500, 503])('keeps credentials after transient HTTP %s', async (status) => {
    mocks.malHttpFetch.mockResolvedValue(new Response('{"error":"temporarily_unavailable"}', {
      status,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(refreshMal()).resolves.toBeNull()
    expect(get(malToken)).toBe('access-old')
    expect(get(malRefresh)).toBe('refresh-old')
    expect(get(malTokenExpiry)).toBe(123)
    expect(get(malUserName)).toBe('viewer')
  })

  it('disconnects after a confirmed invalid_grant response', async () => {
    mocks.malHttpFetch.mockResolvedValue(new Response('{"error":"invalid_grant"}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(refreshMal()).resolves.toBeNull()
    expect(get(malToken)).toBeNull()
    expect(get(malRefresh)).toBeNull()
    expect(get(malTokenExpiry)).toBe(0)
    expect(get(malUserName)).toBe('')
    expect(get(malUserAvatar)).toBe('')
  })

  it('rotates credentials after a successful refresh', async () => {
    mocks.malHttpFetch.mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-new',
      refresh_token: 'refresh-new',
      expires_in: 3600,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(refreshMal()).resolves.toBe('access-new')
    expect(get(malToken)).toBe('access-new')
    expect(get(malRefresh)).toBe('refresh-new')
    expect(get(malTokenExpiry)).toBeGreaterThan(Date.now())
  })
})
