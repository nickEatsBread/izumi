import { afterEach, describe, it, expect, vi } from 'vitest'
import { classifyAuth, authError, isArchiveName, isDecoy, poll, debridBlocked, isDebridBlocked, isRetryableStatus, debridHttpError, isDebridRetryable, isDebridThrottled } from './http'

describe('classifyAuth', () => {
  // Real-Debrid — HTTP status only
  it('RD 401 -> token', () => expect(classifyAuth({ status: 401 })).toBe('token'))
  it('RD 403 -> access (locked / not-premium is ambiguous)', () => expect(classifyAuth({ status: 403 })).toBe('access'))
  it('RD 451 DMCA is not an auth failure', () => expect(classifyAuth({ status: 451 })).toBeUndefined())
  // AllDebrid — envelope codes
  it('AllDebrid AUTH_BAD_APIKEY -> token', () => expect(classifyAuth({ code: 'AUTH_BAD_APIKEY' })).toBe('token'))
  it('AllDebrid AUTH_MISSING_APIKEY -> token', () => expect(classifyAuth({ code: 'AUTH_MISSING_APIKEY' })).toBe('token'))
  it('AllDebrid AUTH_BLOCKED -> token', () => expect(classifyAuth({ code: 'AUTH_BLOCKED' })).toBe('token'))
  it('AllDebrid MUST_BE_PREMIUM -> subscription', () => expect(classifyAuth({ code: 'MUST_BE_PREMIUM' })).toBe('subscription'))
  it('AllDebrid FREE_TRIAL_LIMIT_REACHED -> subscription', () => expect(classifyAuth({ code: 'FREE_TRIAL_LIMIT_REACHED' })).toBe('subscription'))
  // TorBox
  it('TorBox BAD_TOKEN -> token', () => expect(classifyAuth({ code: 'BAD_TOKEN' })).toBe('token'))
  it('TorBox NO_AUTH -> token', () => expect(classifyAuth({ code: 'NO_AUTH' })).toBe('token'))
  it('TorBox AUTH_ERROR -> token', () => expect(classifyAuth({ code: 'AUTH_ERROR' })).toBe('token'))
  // Debrid-Link
  it('Debrid-Link badToken -> token', () => expect(classifyAuth({ code: 'badToken' })).toBe('token'))
  it('Debrid-Link expired_token -> token', () => expect(classifyAuth({ code: 'expired_token' })).toBe('token'))
  it('Debrid-Link invalid_client -> token', () => expect(classifyAuth({ code: 'invalid_client' })).toBe('token'))
  // Premiumize — human message
  it('Premiumize "Invalid API key." -> token', () => expect(classifyAuth({ message: 'Invalid API key.' })).toBe('token'))
  it('Premiumize "Not logged in" -> token', () => expect(classifyAuth({ message: 'Not logged in' })).toBe('token'))
  it('Premiumize "Not premium." -> subscription', () => expect(classifyAuth({ message: 'Not premium.' })).toBe('subscription'))
  // Offcloud — live probe (2026-07-25) answers HTTP 401 {"error":"NOAUTH"}
  it('Offcloud "Bad API key" -> token', () => expect(classifyAuth({ message: 'Bad API key' })).toBe('token'))
  it('Offcloud NOAUTH (unspaced) -> token even without the status', () => expect(classifyAuth({ message: 'NOAUTH' })).toBe('token'))
  // Deepbrid — errors arrive as HTTP 200 bodies, so the message has to carry the signal
  it('Deepbrid 402 -> subscription', () => expect(classifyAuth({ status: 402 })).toBe('subscription'))
  it('Deepbrid "You aren\'t a premium user" -> subscription', () =>
    expect(classifyAuth({ status: 200, message: "You aren't a premium user" })).toBe('subscription'))
  // Mega-Debrid
  it('Mega-Debrid "Token error, please log-in" -> token', () => expect(classifyAuth({ message: 'Token error, please log-in' })).toBe('token'))
  // OpenSubtitles — HTTP 401 is returned for BOTH a spent quota AND a bad key; the body decides.
  it('OpenSubtitles 401 quota body -> quota (body wins over status)', () =>
    expect(classifyAuth({ status: 401, message: 'You have downloaded your allowed 20 subtitles for 24 hours.' })).toBe('quota'))
  it('OpenSubtitles 401 "remaining downloads: 0" -> quota', () =>
    expect(classifyAuth({ status: 401, message: 'remaining downloads: 0' })).toBe('quota'))
  it('OpenSubtitles 401 "Invalid API key" -> token (not quota)', () =>
    expect(classifyAuth({ status: 401, message: 'Invalid API key' })).toBe('token'))
  it('OpenSubtitles bare 401 with no body stays token', () =>
    expect(classifyAuth({ status: 401 })).toBe('token'))
  // Combined + negatives
  it('both premium AND key keywords -> access', () => expect(classifyAuth({ message: 'premium api key invalid' })).toBe('access'))
  it('a non-auth message is undefined', () => expect(classifyAuth({ status: 200, message: 'not cached' })).toBeUndefined())
  it('an empty signal is undefined', () => expect(classifyAuth({})).toBeUndefined())
})

describe('authError', () => {
  it('token message names the provider, the credential, and the Settings location', () => {
    const m = authError('Real-Debrid', { status: 401 })!
    expect(m).toContain('Real-Debrid')
    expect(m).toContain('API key')
    expect(m).toContain('Settings → Extensions')
  })
  it('subscription message tells the user to renew', () => {
    const m = authError('AllDebrid', { code: 'MUST_BE_PREMIUM' })!
    expect(m).toContain('AllDebrid')
    expect(m.toLowerCase()).toContain('subscription')
    expect(m).toContain('Renew')
  })
  it('access (combined) message covers both token and subscription', () => {
    const m = authError('Real-Debrid', { status: 403 })!
    expect(m.toLowerCase()).toContain('subscription')
    expect(m).toContain('API key')
  })
  it('credNoun "login" is used for userpass providers instead of "API key"', () => {
    const m = authError('Mega-Debrid', { message: 'Token error, please log-in' }, 'login')!
    expect(m).toContain('login')
    expect(m).not.toContain('API key')
  })
  it('quota message names the limit, the daily allowance, and the Subtitles settings location', () => {
    const m = authError('OpenSubtitles', { status: 401, message: 'You have downloaded your allowed 20 subtitles for 24 hours.' })!
    expect(m).toContain('OpenSubtitles')
    expect(m).toContain('limit reached')
    expect(m).toContain('20/day')
    expect(m).toContain('Settings → Subtitles')
    expect(m).not.toContain('Settings → Extensions')
  })
  it('returns undefined for a non-auth failure so the caller keeps its own message', () => {
    expect(authError('Real-Debrid', { status: 451 })).toBeUndefined()
    expect(authError('Premiumize', { status: 200, message: 'not cached' })).toBeUndefined()
  })
})

describe('debridBlocked', () => {
  it('tags the error so the picker can offer a direct-P2P retry', () => {
    const e = debridBlocked('Real-Debrid blocked this release (DMCA/legal) — pick a different source.')
    expect(e).toBeInstanceOf(Error)
    expect(isDebridBlocked(e)).toBe(true)
  })
  it('does not flag ordinary errors or non-errors', () => {
    expect(isDebridBlocked(new Error('Real-Debrid request failed (500).'))).toBe(false)
    expect(isDebridBlocked('blocked')).toBe(false)
    expect(isDebridBlocked(undefined)).toBe(false)
  })
})

describe('isRetryableStatus', () => {
  it('"not right now" statuses are worth another probe', () => {
    for (const s of [408, 425, 429, 500, 502, 503, 504]) expect(isRetryableStatus(s)).toBe(true)
  })
  it('auth and dead-request statuses are not', () => {
    for (const s of [400, 401, 402, 403, 404, 410, 451]) expect(isRetryableStatus(s)).toBe(false)
  })
})

describe('debridHttpError', () => {
  it('tags a 5xx so a poll can ride it out', () => {
    expect(isDebridRetryable(debridHttpError(502, 'TorBox request failed (502).'))).toBe(true)
    expect(isDebridRetryable(debridHttpError(408, 'TorBox request failed (408).'))).toBe(true)
  })
  it('tags a 429 separately, because a rate limit is a service that IS up', () => {
    const e = debridHttpError(429, 'TorBox request failed (429).')
    expect(isDebridThrottled(e)).toBe(true)
    // Not on the short "it's down" budget — that would kill a resolve minutes into a download.
    expect(isDebridRetryable(e)).toBe(false)
  })
  it('leaves an auth failure untagged, and keeps its message', () => {
    const e = debridHttpError(401, 'TorBox: access denied — your API key looks wrong or expired.')
    expect(isDebridRetryable(e)).toBe(false)
    expect(e.message).toContain('access denied')
  })
})

describe('isArchiveName', () => {
  it('flags the packed archive from the reported bug by URL', () => {
    expect(isArchiveName('https://43-4.download.real-debrid.com/d/PAW7XOH3ON5H6/Show%20Anime%20Edition%20%28ep.%201-2%20of%202%29.rar')).toBe(true)
  })

  it('flags a bare filename as returned by unrestrict', () => {
    expect(isArchiveName('Show Anime Edition (ep. 1-2 of 2).rar')).toBe(true)
    expect(isArchiveName('pack.zip')).toBe(true)
  })

  it('flags multipart and other archive extensions', () => {
    expect(isArchiveName('file.7z')).toBe(true)
    expect(isArchiveName('file.part1.rar')).toBe(true)
    expect(isArchiveName('file.r00')).toBe(true)
  })

  it('does not flag ordinary video names or a zip-ish query string', () => {
    expect(isArchiveName('Show_01_[rerip][85EDD0D6].mkv')).toBe(false)
    expect(isArchiveName('https://host/d/ABC/Show_01.mp4?token=zip')).toBe(false)
  })

  it('handles a literal percent sign that is not a URL escape', () => {
    expect(isArchiveName('100% Anime Pack.rar')).toBe(true)
  })

  it('is suffix-anchored, not a substring match', () => {
    expect(isArchiveName('movie.rar.mkv')).toBe(false)
  })
})

describe('isDecoy', () => {
  it('flags a served file far smaller than the torrent claimed', () => {
    // When a release is taken down the service can answer with a tiny placeholder clip under the
    // real filename. Playing it looks like a corrupt episode rather than a dead source.
    expect(isDecoy(10_000_000, 1_000_000_000)).toBe(true)
  })
  it('accepts a served file close to the expected size', () => {
    expect(isDecoy(990_000_000, 1_000_000_000)).toBe(false)
  })
  it('accepts exactly half, so a normal rounding gap is never a decoy', () => {
    expect(isDecoy(500, 1000)).toBe(false)
  })
  it('says nothing when either size is unknown', () => {
    expect(isDecoy(undefined, 1000)).toBe(false)
    expect(isDecoy(10, 0)).toBe(false)
  })
})

describe('poll cadence', () => {
  afterEach(() => vi.useRealTimers())

  const stage = (s: string) => ({ stage: s } as never)

  it('probes quickly at first instead of sitting out a fixed three seconds', async () => {
    // A torrent Real-Debrid has ready at ~700ms was not observed until 3000ms, and the caching
    // overlay fired at 1500ms — inside that sleep. A sub-second resolve presented as a
    // full-screen "downloading to debrid" takeover.
    vi.useFakeTimers()
    let calls = 0
    const probe = async () => { calls++; return stage(calls >= 3 ? 'ready' : 'downloading') }

    const done = poll(probe, {})
    await vi.advanceTimersByTimeAsync(800)
    await done

    expect(calls).toBe(3)
  })

  it('backs off to a slow cadence for a genuine download', async () => {
    vi.useFakeTimers()
    let calls = 0
    const probe = async () => { calls++; return stage('downloading') }

    const done = poll(probe, {}).catch(() => {})
    // Run out the ramp (250+500+750+1000+1500+2000 = 6000ms), then a further 3s should buy
    // exactly one more probe, not several.
    await vi.advanceTimersByTimeAsync(6000)
    const afterRamp = calls
    await vi.advanceTimersByTimeAsync(3000)

    expect(calls).toBe(afterRamp + 1)
    vi.useRealTimers()
    await Promise.resolve()
    void done
  })

  it('still honours an explicit interval', async () => {
    vi.useFakeTimers()
    let calls = 0
    const probe = async () => { calls++; return stage(calls >= 2 ? 'ready' : 'downloading') }

    const done = poll(probe, { pollMs: 5000 })
    await vi.advanceTimersByTimeAsync(4999)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(2)
    await done
    expect(calls).toBe(2)
  })
})

describe('poll failure tolerance', () => {
  afterEach(() => vi.useRealTimers())

  const stage = (s: string) => ({ stage: s } as never)
  const blip = () => debridHttpError(502, 'TorBox request failed (502).')
  const throttle = () => debridHttpError(429, 'TorBox request failed (429).')

  it('rides out a transient failure instead of throwing away a download in progress', async () => {
    vi.useFakeTimers()
    let calls = 0
    const probe = async () => {
      calls++
      if (calls === 2) throw blip()
      return stage(calls >= 4 ? 'ready' : 'downloading')
    }

    const done = poll(probe, {})
    await vi.advanceTimersByTimeAsync(10_000)
    await done

    expect(calls).toBe(4)
  })

  it('ends on the first tick for anything not tagged retryable', async () => {
    let calls = 0
    const probe = async () => { calls++; throw new Error('TorBox: access denied — your API key looks wrong or expired.') }

    await expect(poll(probe, {})).rejects.toThrow(/access denied/)
    expect(calls).toBe(1)
  })

  it('turns a sustained failure into a real error in well under the 600s deadline', async () => {
    vi.useFakeTimers()
    let calls = 0
    const probe = async () => { calls++; throw blip() }

    const done = expect(poll(probe, {})).rejects.toThrow(/502/)
    await vi.advanceTimersByTimeAsync(60_000)
    await done

    expect(calls).toBe(13) // 12 tolerated, the 13th gives up (~36s at the 3s failure backoff)
  })

  it('resets the run on any successful probe, so an intermittent service still finishes', async () => {
    vi.useFakeTimers()
    let calls = 0
    // Fails far more often than the tolerance allows — just never twice in a row.
    const probe = async () => {
      calls++
      if (calls >= 60) return stage('ready')
      if (calls % 2 === 0) throw blip()
      return stage('downloading')
    }

    const done = poll(probe, {})
    await vi.advanceTimersByTimeAsync(300_000)
    await done

    expect(calls).toBe(60)
  })

  it('rides out a rate limit far longer than an outage, since a 429 means the service is up', async () => {
    vi.useFakeTimers()
    let calls = 0
    const probe = async () => { calls++; throw throttle() }

    const done = expect(poll(probe, { timeoutMs: 600_000 })).rejects.toThrow(/429/)
    await vi.advanceTimersByTimeAsync(300_000)
    await done

    expect(calls).toBe(37) // 36 tolerated, the 37th gives up (~3min at the 5s throttle backoff)
  })

  it('a rate limit that clears is not remembered against the outage budget', async () => {
    vi.useFakeTimers()
    let calls = 0
    // Twenty consecutive 429s — well past the 12-probe outage tolerance, well inside the throttle
    // budget — then the window clears. Before the split this resolve died at probe 13.
    const probe = async () => {
      calls++
      if (calls <= 20) throw throttle()
      return stage('ready')
    }

    const done = poll(probe, {})
    await vi.advanceTimersByTimeAsync(300_000)
    await done

    expect(calls).toBe(21)
  })

  it('cannot fire on a healthy slow download whose probes all answer', async () => {
    vi.useFakeTimers()
    let calls = 0
    const probe = async () => { calls++; return stage('downloading') }

    // Runs out its OWN deadline and reports a timeout — a stage that never leaves 'downloading' is
    // a slow torrent, not a failing service, and must never trip the failure tolerance.
    const done = expect(poll(probe, { timeoutMs: 60_000 })).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(70_000)
    await done

    expect(calls).toBeGreaterThan(20)
  })
})
