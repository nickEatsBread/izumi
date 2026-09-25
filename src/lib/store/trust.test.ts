import { describe, expect, it } from 'vitest'
import { decideStoreTrust, packageSignatureLabel, storeTrustText } from './trust'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

describe('decideStoreTrust', () => {
  it('treats a keyless store as unsigned', () => {
    expect(decideStoreTrust(undefined, false, null)).toEqual({ state: 'unsigned' })
  })
  it('asks to pin the first key it sees', () => {
    expect(decideStoreTrust(undefined, true, A)).toEqual({ state: 'signed', fingerprint: A, pin: A })
  })
  it('accepts the pinned key', () => {
    expect(decideStoreTrust(A, true, A)).toEqual({ state: 'signed', fingerprint: A })
  })
  it('locks on a changed key, a dropped key, or a bad signature', () => {
    expect(decideStoreTrust(A, true, B)).toEqual({ state: 'locked', reason: 'key-changed', fingerprint: B })
    expect(decideStoreTrust(A, false, null)).toEqual({ state: 'locked', reason: 'key-removed' })
    expect(decideStoreTrust(undefined, true, null)).toEqual({ state: 'locked', reason: 'bad-signature' })
  })
})

describe('labels', () => {
  it('describes store trust in plain words', () => {
    expect(storeTrustText(undefined)).toBe('Not loaded yet')
    expect(storeTrustText({ state: 'unsigned' })).toBe('Unsigned')
    expect(storeTrustText({ state: 'signed', fingerprint: A })).toBe('Signed · key aaaaaaaa')
    expect(storeTrustText({ state: 'locked', reason: 'key-changed', fingerprint: B })).toBe('Signing key changed')
    expect(storeTrustText({ state: 'locked', reason: 'key-removed' })).toBe('Stopped signing')
    expect(storeTrustText({ state: 'locked', reason: 'bad-signature' })).toBe('Signature does not match')
  })
  it('only calls a package store-signed when its signer matches the pinned store key', () => {
    expect(packageSignatureLabel(null, A)).toBe('Package unsigned (hash-pinned by the store listing)')
    expect(packageSignatureLabel(A, A)).toBe('Package signed by this store')
    expect(packageSignatureLabel(B, A)).toBe('Package signed by a key this store has not published')
    expect(packageSignatureLabel(A, undefined)).toBe('Package signed by a key this store has not published')
  })
})
