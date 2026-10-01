import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { LEGACY_SECRET_KEY, baseStorageKey, classifyStorageKey, exportDecision, harvestSecretStrings, mergeFieldValue, redactFieldValue, type StorageKeyClass } from './key-policy'
import { SYNCED_SETTING_KEYS } from '$lib/sync/manual'
import { transferSettingKeys } from '$lib/nuvio/transfer'

// transfer.ts is imported for transferSettingKeys only. These are the module doubles its own test
// uses (src/lib/nuvio/transfer.test.ts:13-17), so this file loads the import graph that test proves.
vi.mock('$lib/library/local-lists', async () => ({ localLibrary: Object.assign((await import('svelte/store')).writable({ entries: {}, lists: [] }), { ready: Promise.resolve() }), WATCHLIST_ID: 'watchlist', setMediaInLocalList: vi.fn() }))
vi.mock('$lib/player/history', async () => ({ durableHistory: Object.assign((await import('svelte/store')).writable({}), { ready: Promise.resolve() }), mediaSnapshot: (media: unknown) => media }))
vi.mock('$lib/player/progress', async () => ({ durablePositions: (await import('svelte/store')).writable({}), progressKey: (id: number, ep: number) => `${id}:${ep}` }))
vi.mock('$lib/stremio/manifest', () => ({ fetchManifest: vi.fn() }))
vi.mock('$lib/catalog/registry', () => ({ loadCatalogProvider: vi.fn() }))

/** Spec §6.1, key by key. This table is the pin: moving a key to another class is a reviewed decision. */
const POLICY: Record<Exclude<StorageKeyClass, 'unlisted'>, readonly string[]> = {
  secret: [
    'debrid-key', 'stremio-addon-urls', 'disabled-sources',
    'opensubtitles-base', 'opensubtitles-creds', 'opensubtitles-jwt', 'opensubtitles-jwt-exp', 'opensubtitles-stay', 'opensubtitles-user',
    'subdl-api-key', 'jimaku-api-key', 'tmdb-read-token', 'omdb-api-key',
    'anilist-token', 'mal-token', 'mal-refresh', 'kitsu-token', 'kitsu-refresh',
    'simkl-token', 'simkl-viewer-name', 'simkl-viewer-avatar', 'simkl-anime-list-cache-v1',
    'trakt-client-secret', 'trakt-redirect-uri', 'trakt-token', 'trakt-refresh-token', 'trakt-token-expiry',
    'trakt-viewer-name', 'trakt-viewer-slug', 'trakt-viewer-avatar', 'trakt-sync-queue', 'trakt-history-dedupe',
    'nuvio-auth-tokens-v1', 'stremio-account-token', 'stremio-sync-credential-baseline-v1',
    'stremio-account-email', 'stremio-account-id',
  ],
  transient: [
    'trakt-browser-auth-v1', 'companion-client-restore-v1',
    'companion-client-claim-v1', 'izumi-unlocked-profile-v1', 'izumi-reset-requested',
  ],
  device: [
    'izumi-active-profile-v1', 'watch-party-device-id-v1', 'nuvio-client-id-v1',
    'cloudflare-sync-config-v1', 'cloudflare-sync-setup-secret-v1', 'sync-provider-v1', 'sync-device-name',
    'paired-tizen-companions-v1', 'paired-tizen-progress-applied-v1', 'companion-discovery-saves-v1',
    'izumi-pin-throttle-v1',
  ],
  fields: ['downloads', 'torrent-proxy-url'],
  reviewed: [
    'trakt-client-id', 'store-pins-v1', 'extension-urls', 'doh-url', 'sync-relay-url',
    'comments-backend-url', 'debrid-provider', 'debrid-room-notice-ack', 'izumi-profiles-v1',
  ],
}

/** Listed ahead of the code that stores it: the shared PIN throttle (profiles/store.ts) adds it. */
const NOT_YET_IN_SOURCE: ReadonlySet<string> = new Set(['izumi-pin-throttle-v1'])

/** A key name that suggests a sign-in, a credential, or a device or session identity. "pin" only
 *  counts as a whole name segment, so keeping/mapping/shipping/spinner keys are not flagged. */
const AUTH_ISH = /(token|secret|password|credential|creds|api.?key|jwt|auth|refresh|session|account|email|device-(?:id|name)|client-id|claim|unlock|pair|baseline|(?:^|-)pins?(?:-|$)|profile|companion)/i

const SRC = fileURLToPath(new URL('../../', import.meta.url))

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'paraglide') sourceFiles(path, out)
    } else if (/\.(?:ts|svelte)$/.test(entry.name) && !/\.(?:test|d)\.ts$/.test(entry.name)) {
      out.push(path)
    }
  }
  return out
}

/** Every storage key the app code names: persisted stores (plain, profiled or database-backed,
 *  including calls split over several lines), direct localStorage/sessionStorage calls,
 *  profileStorageKey() literals and *KEY constants. */
const KEY_PATTERNS = [
  /\b(?:profiledPersisted|persisted|databasePersisted)\s*(?:<[^()]*?>)?\(\s*(?:profileStorageKey\(\s*)?['"]([^'"]+)['"]/g,
  /\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g,
  /\bprofileStorageKey\(\s*['"]([^'"]+)['"]/g,
  /\b[A-Z][A-Z0-9_]*KEY\s*=\s*['"]([^'"]+)['"]/g,
  /\bconst\s+(?:storageKey|KEY)\s*=\s*['"]([^'"]+)['"]/g,
]
const KEY_SHAPE = /^[a-z][a-z0-9-]*$/

/** key → the first file (relative to src/) that names it. */
function storageKeysInSource(): Map<string, string> {
  const keys = new Map<string, string>()
  for (const file of [...sourceFiles(join(SRC, 'lib')), ...sourceFiles(join(SRC, 'routes'))]) {
    const source = readFileSync(file, 'utf8')
    for (const pattern of KEY_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const key = match[1]
        if (KEY_SHAPE.test(key) && !keys.has(key)) keys.set(key, file.slice(SRC.length))
      }
    }
  }
  return keys
}

describe('classifyStorageKey', () => {
  const cases = Object.entries(POLICY).flatMap(([kind, keys]) => keys.map((key) => [key, kind] as [string, string]))

  it.each(cases)('%s is %s, in every profile', (key, kind) => {
    expect(classifyStorageKey(key)).toBe(kind)
    expect(classifyStorageKey(`izumi-profile:profile-kid:${key}`)).toBe(kind)
  })

  it('keeps PIN verifiers in every backup: izumi-profiles-v1 is reviewed profile data (spec §6.3)', () => {
    expect(classifyStorageKey('izumi-profiles-v1')).toBe('reviewed')
    expect(exportDecision('izumi-profiles-v1', false)).toBe('export')
    expect(exportDecision('izumi-profiles-v1', true)).toBe('export')
  })

  it('falls back to the legacy name test for keys the policy does not name', () => {
    expect(LEGACY_SECRET_KEY.source).toBe('(token|secret|password|credential|api.?key|jwt|debrid|opensubtitles-creds|addon.*url)')
    expect(LEGACY_SECRET_KEY.flags).toBe('i')
    expect(classifyStorageKey('future-service-token')).toBe('secret')
    expect(classifyStorageKey('izumi-profile:profile-kid:future-api-key')).toBe('secret')
    expect(classifyStorageKey('ui-scale')).toBe('unlisted')
    expect(classifyStorageKey('local-media-library-v1')).toBe('unlisted')
    expect(classifyStorageKey('izumi-profile:profile-kid:local-history')).toBe('unlisted')
  })

  it('strips only a profile partition prefix', () => {
    expect(baseStorageKey('izumi-profile:profile-1a2b:mal-token')).toBe('mal-token')
    expect(baseStorageKey('izumi-profile:profile_1-2:downloads')).toBe('downloads')
    expect(baseStorageKey('mal-token')).toBe('mal-token')
    expect(baseStorageKey('izumi-profiles-v1')).toBe('izumi-profiles-v1')
    expect(baseStorageKey('izumi-profile:default')).toBe('izumi-profile:default')
  })
})

describe('exportDecision', () => {
  it('skips device and session keys even with secrets, and redacts secrets only without them', () => {
    expect(exportDecision('debrid-key', false)).toBe('redact')
    expect(exportDecision('debrid-key', true)).toBe('export')
    expect(exportDecision('izumi-profile:profile-kid:trakt-token', false)).toBe('redact')
    expect(exportDecision('cloudflare-sync-config-v1', true)).toBe('skip')
    expect(exportDecision('trakt-browser-auth-v1', true)).toBe('skip')
    expect(exportDecision('downloads', false)).toBe('export')
    expect(exportDecision('debrid-provider', false)).toBe('export')
    expect(exportDecision('ui-scale', false)).toBe('export')
  })
})

describe('storage keys in the source', () => {
  const keys = storageKeysInSource()

  it('finds the keys behind every storage API the app uses', () => {
    expect(keys.size).toBeGreaterThan(200)
    for (const key of ['downloads', 'izumi-profiles-v1', 'debrid-key', 'local-media-library-v1', 'companion-client-claim-v1', 'izumi-reset-requested', 'catalog-default-provider', 'trakt-browser-auth-v1']) {
      expect(keys.has(key), key).toBe(true)
    }
  })

  it('gives every auth-ish key a policy', () => {
    const unclassified = [...keys]
      .filter(([key]) => AUTH_ISH.test(key) && classifyStorageKey(key) === 'unlisted')
      .map(([key, file]) => `${key} (${file})`)
    expect(unclassified).toEqual([])
  })

  it('keeps every opensubtitles-, simkl- and trakt- key secret, apart from the reviewed client id and the in-flight sign-in', () => {
    const service = [...keys.keys()].filter((key) => /^(?:opensubtitles|simkl|trakt)-/.test(key))
    expect(service.length).toBeGreaterThan(10)
    for (const key of service) {
      const expected = key === 'trakt-client-id' ? 'reviewed' : key === 'trakt-browser-auth-v1' ? 'transient' : 'secret'
      expect(classifyStorageKey(key), key).toBe(expected)
    }
  })

  it('names only keys the app really stores', () => {
    const stale = Object.values(POLICY).flat().filter((key) => !keys.has(key) && !NOT_YET_IN_SOURCE.has(key))
    expect(stale).toEqual([])
  })
})

describe('keys that leave the device by other routes', () => {
  it('never syncs or transfers a secret, transient, device or fields key', () => {
    const shared = [...SYNCED_SETTING_KEYS, ...transferSettingKeys('settings'), ...transferSettingKeys('home')]
    expect(shared.length).toBeGreaterThan(20)
    const leaking = shared.filter((key) => ['secret', 'transient', 'device', 'fields'].includes(classifyStorageKey(key)))
    expect(leaking).toEqual([])
  })
})

describe('fields keys', () => {
  it('drops each download link and nothing else', () => {
    const value = JSON.stringify({ '1:1': { id: '1:1', title: 'Episode 1', url: 'https://debrid.test/dl/token', bytes: 5 }, '2:1': { id: '2:1', title: 'Episode 2' } })
    expect(redactFieldValue('downloads', value)).toEqual({ value: JSON.stringify({ '1:1': { id: '1:1', title: 'Episode 1', bytes: 5 }, '2:1': { id: '2:1', title: 'Episode 2' } }) })
    expect(redactFieldValue('downloads', 'not json')).toEqual({ value: null })
  })

  it('strips the proxy sign-in, says so, and drops a proxy value it cannot read', () => {
    const stripped = redactFieldValue('torrent-proxy-url', '"socks5://me:hunter22@127.0.0.1:1080"')
    expect(stripped.value).toBe('"socks5://127.0.0.1:1080"')
    expect(stripped.note).toContain('proxy username and password were left out')
    expect(redactFieldValue('torrent-proxy-url', '"socks5://127.0.0.1:1080"')).toEqual({ value: '"socks5://127.0.0.1:1080"' })
    const unreadable = redactFieldValue('torrent-proxy-url', '"me:hunter22@127.0.0.1:1080"')
    expect(unreadable.value).toBeNull()
    expect(unreadable.note).toContain('proxy username and password were left out')
    expect(redactFieldValue('nav-config-v1', '[1]')).toEqual({ value: '[1]' })
  })

  it('merges this device\'s download links back by entry id', () => {
    const local = JSON.stringify({ '1:1': { id: '1:1', url: 'https://local.test/1' }, '3:1': { id: '3:1', url: 'https://local.test/3' } })
    const incoming = JSON.stringify({ '1:1': { id: '1:1', title: 'One' }, '2:1': { id: '2:1' } })
    expect(JSON.parse(mergeFieldValue('downloads', incoming, local))).toEqual({ '1:1': { id: '1:1', title: 'One', url: 'https://local.test/1' }, '2:1': { id: '2:1' } })
    expect(mergeFieldValue('downloads', incoming, null)).toBe(incoming)
    const withLink = JSON.stringify({ '1:1': { id: '1:1', url: 'https://file.test/1' } })
    expect(mergeFieldValue('downloads', withLink, local)).toBe(withLink)
  })

  it('keeps this device\'s proxy sign-in only for the same proxy', () => {
    const local = '"socks5://me:hunter22@127.0.0.1:1080"'
    expect(mergeFieldValue('torrent-proxy-url', '"socks5://127.0.0.1:1080"', local)).toBe(local)
    expect(mergeFieldValue('torrent-proxy-url', '"socks5://proxy.test:9050"', local)).toBe('"socks5://proxy.test:9050"')
    expect(mergeFieldValue('torrent-proxy-url', '"socks5://you:secret@127.0.0.1:1080"', local)).toBe('"socks5://you:secret@127.0.0.1:1080"')
    expect(mergeFieldValue('nav-config-v1', '[2]', '[1]')).toBe('[2]')
  })
})

describe('harvestSecretStrings', () => {
  it('takes nothing from a public add-on URL', () => {
    expect(harvestSecretStrings({
      'stremio-addon-urls': JSON.stringify(['https://addon.test/manifest.json', 'https://addon.test/anime-catalog/manifest.json']),
    })).toEqual([])
  })

  it('takes only the config segment, query values and user info of a configured URL', () => {
    expect(harvestSecretStrings({
      'stremio-addon-urls': JSON.stringify([
        'https://addon.test/eyJkZWJyaWQiOiJLRVkifQ0123/manifest.json',
        'https://addon.test/manifest.json?apikey=abcdef0123456789&lang=en',
        'https://me:correct-horse-battery@addon.test/manifest.json',
      ]),
    }).sort()).toEqual(['abcdef0123456789', 'correct-horse-battery', 'eyJkZWJyaWQiOiJLRVkifQ0123'])
  })

  it('takes a plain secret value itself, and only strings of 12 characters or more', () => {
    expect(harvestSecretStrings({
      'debrid-key': '"ABCDEF0123456789"',
      'subdl-api-key': '"short"',
      'nuvio-auth-tokens-v1': JSON.stringify({ accessToken: 'access-0123456789', refreshToken: 'refresh-0123456789', expiresAt: 5, userId: 'u1', email: 'a@b.test' }),
      'mal-token-expiry': '1234567890123',
    }).sort()).toEqual(['ABCDEF0123456789', 'access-0123456789', 'refresh-0123456789'])
  })

  it('reads secret keys only, including profile copies', () => {
    expect(harvestSecretStrings({
      'nav-config-v1': '"NOT-A-SECRET-0123456789"',
      'izumi-profiles-v1': '"reviewed-0123456789"',
      'cloudflare-sync-config-v1': '"device-0123456789"',
      'izumi-profile:profile-kid:trakt-token': '"kid-trakt-0123456789"',
    })).toEqual(['kid-trakt-0123456789'])
  })

  it('reads two levels down, so a list under a field counts but a queued request body does not', () => {
    expect(harvestSecretStrings({
      'stremio-sync-credential-baseline-v1': JSON.stringify({ urls: ['https://addon.test/LONGCONFIG0123456789/manifest.json'] }),
      'izumi-profile:profile-kid:trakt-sync-queue': JSON.stringify([{ id: 'q1', path: '/sync/ratings', body: { shows: [{ title: 'A Long Show Title', images: 'https://img.test/poster-0123456789.jpg' }] }, createdAt: 1 }]),
    }).sort()).toEqual(['/sync/ratings', 'LONGCONFIG0123456789'])
  })
})
