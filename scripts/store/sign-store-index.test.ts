import { createPublicKey, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { STORE_INDEX_DOMAIN, generateStoreKey, publicKeyValue, signStoreIndex } from './sign-store-index.mjs'

describe('store index signing tool', () => {
  it('signs the domain tag plus the exact index bytes, with the key the index declares', () => {
    const { privatePem, publicKey } = generateStoreKey()
    expect(publicKey).toMatch(/^ed25519:[A-Za-z0-9+/]{43}=$/)
    const bytes = Buffer.from(JSON.stringify({ app: 'izumi', kind: 'store', schemaVersion: 1, id: 'com.example.store', name: 'Example', publicKey, entries: [] }))
    const signature = signStoreIndex(bytes, privatePem)
    const raw = Buffer.from(publicKey.slice('ed25519:'.length), 'base64')
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' })
    expect(verify(null, Buffer.concat([STORE_INDEX_DOMAIN, bytes]), key, Buffer.from(signature, 'base64'))).toBe(true)
    expect(verify(null, bytes, key, Buffer.from(signature, 'base64'))).toBe(false)
    expect(publicKeyValue(key)).toBe(publicKey)
  })

  it('refuses to sign an index that declares a different key', () => {
    const { privatePem } = generateStoreKey()
    const other = generateStoreKey().publicKey
    expect(() => signStoreIndex(Buffer.from(JSON.stringify({ publicKey: other })), privatePem)).toThrow('publicKey must be')
  })
})
