import type { DebridProvider, DebridProviderMeta, ResolveOpts } from './types'
import { realdebrid } from './providers/realdebrid'
import { alldebrid } from './providers/alldebrid'
import { premiumize } from './providers/premiumize'
import { torbox } from './providers/torbox'
import { debridlink } from './providers/debridlink'
import { offcloud } from './providers/offcloud'
import { deepbrid } from './providers/deepbrid'
import { linksnappy } from './providers/linksnappy'
import { megadebrid } from './providers/megadebrid'

export type { DebridProvider, DebridProviderMeta, DebridInfo, ResolveOpts } from './types'

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
