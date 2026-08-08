import { describe, expect, it } from 'vitest'
import { nextBetaVersion } from './next-beta-version.mjs'

// The `--preid beta` scheme produced `0.1.17-beta.0`, which Tauri's MSI bundler rejects outright:
// "optional pre-release identifier in app version must be numeric-only". Every target except
// Windows built, then the release run failed. These cases pin the numeric scheme every earlier beta
// actually used.

describe('nextBetaVersion', () => {
  it('advances the patch when the current version is stable', () => {
    // A beta precedes the release it will become, so it cannot sit on the version already shipped.
    expect(nextBetaVersion('0.1.16')).toBe('0.1.17-1')
    expect(nextBetaVersion('0.2.0')).toBe('0.2.1-1')
  })

  it('increments the counter on an existing beta without moving the patch', () => {
    expect(nextBetaVersion('0.1.17-1')).toBe('0.1.17-2')
    expect(nextBetaVersion('0.1.17-9')).toBe('0.1.17-10')
  })

  it('restarts the counter when it finds the old non-numeric identifier', () => {
    // Recovery path: main was left on 0.1.17-beta.0 by the run that exposed this.
    expect(nextBetaVersion('0.1.17-beta.0')).toBe('0.1.17-1')
    expect(nextBetaVersion('0.1.17-rc.2')).toBe('0.1.17-1')
  })

  it('never emits a non-numeric identifier, whatever it is given', () => {
    for (const input of ['1.0.0', '1.0.0-1', '1.0.0-beta.7', '10.20.30', '10.20.30-4']) {
      expect(nextBetaVersion(input)).toMatch(/^\d+\.\d+\.\d+-\d+$/)
    }
  })

  it('refuses a version it cannot parse rather than guessing', () => {
    expect(() => nextBetaVersion('not-a-version')).toThrow(/Unparseable/)
    expect(() => nextBetaVersion('1.2')).toThrow(/Unparseable/)
  })
})
