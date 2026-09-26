#!/usr/bin/env node
// Sign an izumi store index (docs/superpowers/specs/2026-09-25-plugins-stores-packs-design.md §6.3).
//
//   node scripts/store/sign-store-index.mjs keygen <private-key.pem>
//     Writes a new Ed25519 private key (refuses to overwrite) and prints the `ed25519:…` value to put
//     in the index's "publicKey" field. Keep the private key out of any repository.
//   node scripts/store/sign-store-index.mjs sign <index.json> <private-key.pem>
//     Writes <index.json>.sig. The signature covers the tag `izumi-store-index-v1\n` followed by the
//     exact bytes of the file (UTF-8, no BOM), so sign last and publish the two files together.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Signed ahead of the index bytes (domain separation); must match STORE_INDEX_DOMAIN in
 *  src-tauri/src/store_trust.rs. */
export const STORE_INDEX_DOMAIN = Buffer.from('izumi-store-index-v1\n')

/** The `ed25519:<base64 raw 32-byte key>` form a store index declares. */
export function publicKeyValue(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' })
  return `ed25519:${Buffer.from(jwk.x, 'base64url').toString('base64')}`
}

export function generateStoreKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }), publicKey: publicKeyValue(publicKey) }
}

/** Base64 Ed25519 signature over the index bytes. Refuses an index that declares another key. */
export function signStoreIndex(indexBytes, privatePem) {
  const key = createPrivateKey(privatePem)
  const declared = JSON.parse(indexBytes.toString('utf8')).publicKey
  const expected = publicKeyValue(createPublicKey(key))
  if (declared !== expected) throw new Error(`The index's publicKey must be ${expected} before signing.`)
  return sign(null, Buffer.concat([STORE_INDEX_DOMAIN, indexBytes]), key).toString('base64')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, first, second] = process.argv.slice(2)
  if (command === 'keygen' && first) {
    const { privatePem, publicKey } = generateStoreKey()
    writeFileSync(first, privatePem, { mode: 0o600, flag: 'wx' })
    console.log(publicKey)
  } else if (command === 'sign' && first && second) {
    const signature = signStoreIndex(readFileSync(first), readFileSync(second, 'utf8'))
    writeFileSync(`${first}.sig`, `${signature}\n`)
    console.log(`Wrote ${first}.sig`)
  } else {
    console.error('Usage: sign-store-index.mjs keygen <private-key.pem> | sign <index.json> <private-key.pem>')
    process.exit(2)
  }
}
