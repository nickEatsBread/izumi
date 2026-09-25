import type { ExtensionCatalogPackage } from '$lib/extensions/catalog'

// Trust decisions for stores and the packages they publish (spec §5.1 rule 3, §6.7). Pure.

export type StoreTrust =
  | { state: 'unsigned' }
  /** `pin` is set the first time a store's key is seen; the caller persists it (trust on first use). */
  | { state: 'signed'; fingerprint: string; pin?: string }
  | { state: 'locked'; reason: 'key-changed' | 'key-removed' | 'bad-signature'; fingerprint?: string }

/**
 * @param pinned    fingerprint pinned for this store, if any
 * @param declared  whether the listing declares a signing key
 * @param verified  fingerprint of the key that verified the listing's signature, or null
 */
export function decideStoreTrust(pinned: string | undefined, declared: boolean, verified: string | null): StoreTrust {
  if (!declared) return pinned ? { state: 'locked', reason: 'key-removed' } : { state: 'unsigned' }
  if (!verified) return { state: 'locked', reason: 'bad-signature' }
  if (!pinned) return { state: 'signed', fingerprint: verified, pin: verified }
  return pinned === verified
    ? { state: 'signed', fingerprint: verified }
    : { state: 'locked', reason: 'key-changed', fingerprint: verified }
}

/** Plain words for a store's trust state, for the Manage stores list. */
export function storeTrustText(trust: StoreTrust | undefined): string {
  if (!trust) return 'Not loaded yet'
  if (trust.state === 'unsigned') return 'Unsigned'
  if (trust.state === 'signed') return `Signed · key ${trust.fingerprint.slice(0, 16)}`
  if (trust.reason === 'key-changed') return 'Signing key changed'
  if (trust.reason === 'key-removed') return 'Stopped signing'
  return 'Signature does not match'
}

/** Whether a store listing pins this package's download by hash. Aniyomi indexes often don't. */
export function packageHashPinned(pkg: ExtensionCatalogPackage): boolean {
  const hash = pkg.packageFormat === 'aniyomi-repo' ? pkg.apkSha256 : pkg.packageSha256
  return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash)
}

/** What a package's own signature says about who published it, relative to its store. */
export function packageSignatureLabel(
  signerKey: string | null | undefined,
  storePin: string | undefined,
  hashPinned: boolean,
): string {
  if (!signerKey) {
    return hashPinned ? 'Package unsigned (hash-pinned by the store listing)' : 'Package unsigned and not hash-pinned by its store'
  }
  if (storePin && signerKey === storePin) return 'Package signed by this store'
  return 'Package signed by a key this store has not published'
}
