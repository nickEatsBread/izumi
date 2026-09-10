import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The link module must never reach the network from a unit test: the transport is injected below,
// and the real one is replaced so a regression that ignores the injection fails loudly.
const mocks = vi.hoisted(() => ({ trackerHttpFetch: vi.fn(() => { throw new Error('no network in tests') }) }))
vi.mock('$lib/trackers/tracker-http', () => ({ trackerHttpFetch: mocks.trackerHttpFetch }))

import {
  createStremioLink,
  pollStremioLink,
  STREMIO_LINK_ORIGIN,
  STREMIO_LINK_POLL_ATTEMPTS,
  STREMIO_LINK_POLL_INTERVAL_MS,
  type StremioLinkStatus,
  type StremioLinkTransport,
} from './link'

/** The envelope link.stremio.com actually answers /api/create with. */
const created = (code = '0GI5', link = `${STREMIO_LINK_ORIGIN}/${code}`) => ({
  success: true,
  code,
  link,
  qrcode: `${STREMIO_LINK_ORIGIN}/qr?data=${encodeURIComponent(link)}`,
  result: { success: true, code, link },
  error: null,
})

/** The answer to every poll before the user approves — and after the code lapses. */
const pendingReply = { result: null, error: { code: 101, message: 'Invalid or expired token' } }

const transportOf = () => vi.fn<StremioLinkTransport>()

beforeEach(() => { mocks.trackerHttpFetch.mockClear(); vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  expect(mocks.trackerHttpFetch).not.toHaveBeenCalled()
})

describe('Stremio link codes', () => {
  it('reads the code and approval link out of a create response', async () => {
    const transport = transportOf()
    transport.mockResolvedValue(created())
    await expect(createStremioLink(undefined, transport)).resolves.toEqual({
      code: '0GI5',
      url: `${STREMIO_LINK_ORIGIN}/0GI5`,
    })
    expect(transport.mock.calls[0][0]).toBe(`${STREMIO_LINK_ORIGIN}/api/create?type=Create`)
  })

  it('reads a create response that only fills the top level', async () => {
    const transport = transportOf()
    transport.mockResolvedValue({ ...created(), result: { success: true } })
    await expect(createStremioLink(undefined, transport)).resolves.toEqual({
      code: '0GI5',
      url: `${STREMIO_LINK_ORIGIN}/0GI5`,
    })
  })

  it('refuses an approval link that is not Stremio, so nothing foreign can be opened', async () => {
    const transport = transportOf()
    for (const link of ['https://link.stremio.com.attacker.test/0GI5', 'http://link.stremio.com/0GI5', 'javascript:alert(1)']) {
      transport.mockResolvedValue(created('0GI5', link))
      await expect(createStremioLink(undefined, transport)).rejects.toThrow(/sign-in link/)
    }
  })

  it('refuses credentials smuggled into an otherwise valid Stremio link', async () => {
    const transport = transportOf()
    transport.mockResolvedValue(created('0GI5', 'https://user:secret@link.stremio.com/0GI5'))
    await expect(createStremioLink(undefined, transport)).rejects.toThrow('outside link.stremio.com')
  })

  it('refuses a create response with no usable code', async () => {
    const transport = transportOf()
    for (const code of ['', '   ', 'not a code', 'x'.repeat(33)]) {
      transport.mockResolvedValue({ ...created(), code, result: { code, link: `${STREMIO_LINK_ORIGIN}/x` } })
      await expect(createStremioLink(undefined, transport)).rejects.toThrow('usable sign-in code')
    }
  })

  it('reports a create failure with the message the service gave', async () => {
    const transport = transportOf()
    transport.mockResolvedValue({ result: null, error: { code: 2, message: 'Service unavailable' } })
    await expect(createStremioLink(undefined, transport)).rejects.toThrow('Service unavailable')
  })
})

describe('Stremio link polling', () => {
  it('keeps waiting through the pending error and returns the approved session key', async () => {
    const transport = transportOf()
    const states: StremioLinkStatus[] = []
    transport
      .mockResolvedValueOnce(pendingReply)
      .mockResolvedValueOnce(pendingReply)
      .mockResolvedValueOnce({ result: { authKey: 'session-key' }, error: null })
    const pending = pollStremioLink('0GI5', (status) => states.push(status), undefined, transport)
    await vi.advanceTimersByTimeAsync(STREMIO_LINK_POLL_INTERVAL_MS * 3)
    await expect(pending).resolves.toBe('session-key')
    expect(states).toEqual(['waiting', 'approved'])
    expect(transport).toHaveBeenCalledTimes(3)
    // Only the public code may travel in the URL. The session key is never put into one.
    expect(transport.mock.calls[0][0]).toBe(`${STREMIO_LINK_ORIGIN}/api/read?type=Read&code=0GI5`)
    for (const [url] of transport.mock.calls) expect(url).not.toContain('session-key')
  })

  it('accepts a session key returned as the result itself', async () => {
    const transport = transportOf()
    transport.mockResolvedValue({ result: 'bare-session-key', error: null })
    const pending = pollStremioLink('0GI5', () => {}, undefined, transport)
    await vi.advanceTimersByTimeAsync(STREMIO_LINK_POLL_INTERVAL_MS)
    await expect(pending).resolves.toBe('bare-session-key')
  })

  it('fails clearly when an approval carries no session key', async () => {
    const transport = transportOf()
    transport.mockResolvedValue({ result: { user: { email: 'viewer@example.test' } }, error: null })
    const pending = pollStremioLink('0GI5', () => {}, undefined, transport)
    const rejected = expect(pending).rejects.toThrow('no session key')
    await vi.advanceTimersByTimeAsync(STREMIO_LINK_POLL_INTERVAL_MS)
    await rejected
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('stops at once on an error that is not the pending one', async () => {
    const transport = transportOf()
    transport.mockResolvedValue({ result: null, error: { code: 4, message: 'User not found' } })
    const pending = pollStremioLink('0GI5', () => {}, undefined, transport)
    const rejected = expect(pending).rejects.toThrow('User not found')
    await vi.advanceTimersByTimeAsync(STREMIO_LINK_POLL_INTERVAL_MS)
    await rejected
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('gives up on a bounded window instead of polling an expired code forever', async () => {
    const transport = transportOf()
    transport.mockResolvedValue(pendingReply)
    const pending = pollStremioLink('0GI5', () => {}, undefined, transport)
    const rejected = expect(pending).rejects.toThrow('expired')
    await vi.advanceTimersByTimeAsync(STREMIO_LINK_POLL_INTERVAL_MS * (STREMIO_LINK_POLL_ATTEMPTS + 5))
    await rejected
    expect(transport).toHaveBeenCalledTimes(STREMIO_LINK_POLL_ATTEMPTS)
    expect(STREMIO_LINK_POLL_INTERVAL_MS * STREMIO_LINK_POLL_ATTEMPTS).toBeLessThanOrEqual(300_000)
  })

  it('rides out a transport blip but surrenders to a sustained outage', async () => {
    const transport = transportOf()
    transport
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(pendingReply)
      .mockResolvedValueOnce({ result: { authKey: 'session-key' }, error: null })
    const recovered = pollStremioLink('0GI5', () => {}, undefined, transport)
    await vi.advanceTimersByTimeAsync(STREMIO_LINK_POLL_INTERVAL_MS * 3)
    await expect(recovered).resolves.toBe('session-key')

    const offline = transportOf()
    offline.mockRejectedValue(new Error('offline'))
    const pending = pollStremioLink('0GI5', () => {}, undefined, offline)
    const rejected = expect(pending).rejects.toThrow('offline')
    await vi.advanceTimersByTimeAsync(STREMIO_LINK_POLL_INTERVAL_MS * 5)
    await rejected
    expect(offline).toHaveBeenCalledTimes(3)
  })

  it('abandons the code the moment the user cancels', async () => {
    const transport = transportOf()
    transport.mockResolvedValue(pendingReply)
    const abort = new AbortController()
    const pending = pollStremioLink('0GI5', () => {}, abort.signal, transport)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    await rejected
    await vi.advanceTimersByTimeAsync(STREMIO_LINK_POLL_INTERVAL_MS * 10)
    expect(transport).not.toHaveBeenCalled()
  })

  it('never starts a poll for an empty code', async () => {
    const transport = transportOf()
    await expect(pollStremioLink('  ', () => {}, undefined, transport)).rejects.toThrow('usable sign-in code')
    expect(transport).not.toHaveBeenCalled()
  })
})
