import { describe, it, expect } from 'vitest'
import { classifyAuth, authError } from './http'

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
  // Offcloud
  it('Offcloud "Bad API key" -> token', () => expect(classifyAuth({ message: 'Bad API key' })).toBe('token'))
  // Deepbrid
  it('Deepbrid 402 -> subscription', () => expect(classifyAuth({ status: 402 })).toBe('subscription'))
  // LinkSnappy
  it('LinkSnappy "Invalid API Key" -> token', () => expect(classifyAuth({ message: 'Invalid API Key' })).toBe('token'))
  it('LinkSnappy "Account not active" -> subscription', () => expect(classifyAuth({ message: 'Account not active' })).toBe('subscription'))
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
  it('returns undefined for a non-auth failure so the caller keeps its own message', () => {
    expect(authError('Real-Debrid', { status: 451 })).toBeUndefined()
    expect(authError('Premiumize', { status: 200, message: 'not cached' })).toBeUndefined()
  })
})
