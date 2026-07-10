import type { DebridProvider, DebridProviderMeta, ResolveOpts, DebridItem, DebridFile } from './types'
import { realdebrid } from './providers/realdebrid'
import { alldebrid } from './providers/alldebrid'
import { premiumize } from './providers/premiumize'
import { torbox } from './providers/torbox'
import { debridlink } from './providers/debridlink'
import { offcloud } from './providers/offcloud'
import { deepbrid } from './providers/deepbrid'
import { linksnappy } from './providers/linksnappy'
import { megadebrid } from './providers/megadebrid'

export type { DebridProvider, DebridProviderMeta, DebridInfo, ResolveOpts, DebridItem, DebridFile } from './types'

// Stable providers first, experimental last (Cocoleech/DASAN are omitted — link-only,
// can't resolve a torrent infoHash).
const PROVIDERS: DebridProvider[] = [
  realdebrid, alldebrid, premiumize, torbox, debridlink, offcloud,
  deepbrid, linksnappy, megadebrid,
]

export const providers = new Map(PROVIDERS.map((p) => [p.id, p]))

/** Metadata for the settings <select>. */
export const providerList: DebridProviderMeta[] = PROVIDERS.map(
  ({ id, name, keyHint, credential, experimental }) => ({ id, name, keyHint, credential, experimental }),
)

export const providerName = (id: string) => providers.get(id)?.name ?? 'debrid'
export const providerMeta = (id: string) => providerList.find((p) => p.id === id)

/** Thin dispatcher — play.ts calls this to resolve an infoHash to a playable URL. */
export function resolveHash(providerId: string, key: string, hashOrMagnet: string, opts?: ResolveOpts): Promise<string> {
  const p = providers.get(providerId)
  if (!p) throw new Error(`Unknown debrid provider "${providerId}".`)
  return p.resolveHash(key, hashOrMagnet, opts)
}

/** Does this provider expose account listing? Gates the Cloud menu. */
export function supportsListing(providerId: string): boolean {
  return typeof providers.get(providerId)?.listItems === 'function'
}

export function listItems(providerId: string, key: string): Promise<DebridItem[]> {
  const p = providers.get(providerId)
  if (!p?.listItems) throw new Error(`${p?.name ?? 'This provider'} doesn't support browsing your account.`)
  return p.listItems(key)
}

export function listFiles(providerId: string, key: string, item: DebridItem): Promise<DebridFile[]> {
  const p = providers.get(providerId)
  if (!p?.listFiles) throw new Error(`${p?.name ?? 'This provider'} doesn't support file browsing.`)
  return p.listFiles(key, item)
}

export function resolveFile(providerId: string, key: string, item: DebridItem, file: DebridFile, opts?: ResolveOpts): Promise<string> {
  const p = providers.get(providerId)
  if (!p?.resolveFile) throw new Error(`${p?.name ?? 'This provider'} can't resolve that file.`)
  return p.resolveFile(key, item, file, opts)
}

export function deleteItem(providerId: string, key: string, item: DebridItem): Promise<void> {
  const p = providers.get(providerId)
  if (!p?.deleteItem) throw new Error(`${p?.name ?? 'This provider'} doesn't support deleting.`)
  return p.deleteItem(key, item)
}
