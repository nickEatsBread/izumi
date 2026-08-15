import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginResolveTrace, clearResolveDiagnostics, finishResolveTrace,
  recentResolveDiagnostics, safeRequestTarget, traceResolve,
} from './resolve-trace'

afterEach(() => { vi.restoreAllMocks(); clearResolveDiagnostics() })

describe('resolve trace redaction', () => {
  it('keeps only a host and shallow route label for request targets', () => {
    expect(safeRequestTarget('https://torrentio.strem.fun/resolve/private-token/secret?apikey=hidden'))
      .toBe('torrentio.strem.fun/resolve')
    expect(safeRequestTarget('not a URL')).toBe('native-command')
  })

  it('does not print credential-bearing fields or values', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const trace = beginResolveTrace({ mediaId: 1, episode: 2, title: 'Test', entry: 'test' })
    traceResolve(trace, 'request', {
      url: 'https://example.test/resolve/private-token',
      apiKey: 'super-secret',
      message: 'failed at https://example.test/resolve/super-secret',
      infoHash: '0123456789abcdef0123456789abcdef01234567',
    })
    finishResolveTrace(trace, 'done')

    const output = JSON.stringify(info.mock.calls)
    expect(output).not.toContain('super-secret')
    expect(output).not.toContain('0123456789abcdef0123456789abcdef01234567')
    expect(output).not.toContain('private-token')
    // One serialized console argument survives copy/paste without Chrome collapsing nested values
    // behind an interactive `{…}` preview.
    expect(info.mock.calls.every((call) => call.length === 1 && typeof call[0] === 'string')).toBe(true)
    expect(output).toContain('\\"mediaId\\":1')
  })

  it('keeps bounded release timings without source names, URLs, hashes, or titles', () => {
    const trace = beginResolveTrace({ mediaId: 7, episode: 3, title: 'Private title', entry: 'test' })
    traceResolve(trace, 'provider finish', {
      provider: 'Private provider',
      url: 'https://example.test/private',
      infoHash: '0123456789abcdef0123456789abcdef01234567',
      durationMs: 321,
      rows: 4,
      method: 'search',
    })
    finishResolveTrace(trace, 'playing')

    const report = JSON.stringify(recentResolveDiagnostics())
    expect(report).toContain('321')
    expect(report).toContain('search')
    expect(report).not.toContain('Private')
    expect(report).not.toContain('example.test')
    expect(report).not.toContain('0123456789abcdef')
  })
})
