import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const mocks = vi.hoisted(() => ({ trackerHttpFetch: vi.fn() }))
vi.mock('$lib/trackers/tracker-http', () => ({ trackerHttpFetch: mocks.trackerHttpFetch }))

import {
  connectStremio,
  disconnectStremio,
  pullStremioAddons,
  pushStremioAddons,
  stremioAccountEmail,
  stremioAccountId,
  stremioAuthKey,
} from './account'

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

describe('Stremio account API', () => {
  beforeEach(() => {
    mocks.trackerHttpFetch.mockReset()
    stremioAuthKey.set(null)
    stremioAccountEmail.set('')
    stremioAccountId.set('')
  })

  it('uses the current Stremio Core login envelope and persists only the returned session', async () => {
    mocks.trackerHttpFetch.mockResolvedValue(reply({
      result: { authKey: 'session-key', user: { _id: 'user-1', email: 'viewer@example.com' } },
    }))

    await connectStremio(' viewer@example.com ', 'one-time-password')

    const [, init] = mocks.trackerHttpFetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      type: 'Login',
      email: 'viewer@example.com',
      password: 'one-time-password',
      facebook: false,
    })
    expect(get(stremioAuthKey)).toBe('session-key')
    expect(get(stremioAccountEmail)).toBe('viewer@example.com')
    expect(get(stremioAccountId)).toBe('user-1')
  })

  it('pulls with update enabled and retains complete descriptors', async () => {
    stremioAuthKey.set('session-key')
    const descriptor = {
      manifest: { id: 'example', name: 'Example', version: '1.0.0' },
      transportUrl: 'https://example.test/private/manifest.json',
      flags: { official: true, protected: true },
    }
    mocks.trackerHttpFetch.mockResolvedValue(reply({
      result: { addons: [descriptor], lastModified: '2026-08-01T00:00:00.000Z' },
    }))

    await expect(pullStremioAddons()).resolves.toEqual({
      addons: [descriptor],
      lastModified: '2026-08-01T00:00:00.000Z',
    })
    expect(JSON.parse(mocks.trackerHttpFetch.mock.calls[0][1].body)).toEqual({
      type: 'AddonCollectionGet', authKey: 'session-key', update: true,
    })
  })

  it('pushes the full descriptor collection without rewriting flags', async () => {
    stremioAuthKey.set('session-key')
    const descriptors = [{
      manifest: { id: 'protected', name: 'Protected', version: '1.0.0' },
      transportUrl: 'https://example.test/manifest.json',
      flags: { official: true, protected: true },
    }]
    mocks.trackerHttpFetch.mockResolvedValue(reply({ result: { success: true } }))

    await pushStremioAddons(descriptors)

    expect(JSON.parse(mocks.trackerHttpFetch.mock.calls[0][1].body)).toEqual({
      type: 'AddonCollectionSet', authKey: 'session-key', addons: descriptors,
    })
  })

  it('redacts a session key echoed by an API error', async () => {
    stremioAuthKey.set('very-secret-session')
    mocks.trackerHttpFetch.mockResolvedValue(reply({
      error: { message: 'Invalid very-secret-session', code: 7 },
    }))

    await expect(pullStremioAddons()).rejects.toThrow('Invalid [redacted]')
  })

  it('clears local account state even if remote logout fails', async () => {
    stremioAuthKey.set('session-key')
    stremioAccountEmail.set('viewer@example.com')
    stremioAccountId.set('user-1')
    mocks.trackerHttpFetch.mockRejectedValue(new Error('offline'))

    await disconnectStremio()

    expect(get(stremioAuthKey)).toBeNull()
    expect(get(stremioAccountEmail)).toBe('')
    expect(get(stremioAccountId)).toBe('')
  })
})
