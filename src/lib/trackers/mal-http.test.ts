import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { malHttpFetch } from './mal-http'

describe('malHttpFetch', () => {
  beforeEach(() => { mocks.invoke.mockReset() })

  it('materializes a native GET response as a web Response', async () => {
    mocks.invoke.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"data":[]}',
    })

    const response = await malHttpFetch('https://api.myanimelist.net/v2/users/@me/animelist')

    expect(mocks.invoke).toHaveBeenCalledWith('ext_fetch', {
      url: 'https://api.myanimelist.net/v2/users/@me/animelist',
      method: 'GET',
      headers: {},
      body: undefined,
    })
    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ data: [] })
  })

  it('preserves authorization, method, and form body', async () => {
    mocks.invoke.mockResolvedValue({ status: 204, headers: {}, body: '' })

    await malHttpFetch('https://api.myanimelist.net/v2/anime/1/my_list_status', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status: 'watching' }),
    })

    expect(mocks.invoke).toHaveBeenCalledWith('ext_fetch', expect.objectContaining({
      method: 'PATCH',
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'status=watching',
    }))
  })

  it('rejects a request that does not settle before the UI timeout', async () => {
    mocks.invoke.mockReturnValue(new Promise(() => {}))
    await expect(malHttpFetch('https://api.myanimelist.net/v2/users/@me', {}, 5))
      .rejects.toThrow('MyAnimeList request timed out')
  })
})
