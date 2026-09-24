import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$lib/platform', () => ({ hasTauriRuntime: () => false }))

import { parseBackup } from '$lib/backup'
import {
  preferenceKeysToWipe, snapshotPayload, SNAPSHOT_SENTINEL, storageLooksWiped, wipePreferences,
} from './prefs-snapshot'

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    get length() { return map.size },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
    clear: () => map.clear(),
  } as Storage
}

describe('snapshotPayload', () => {
  it('captures preferences and stays readable', () => {
    const payload = snapshotPayload(memoryStorage({ 'preferred-quality': '1080', 'video-fit': 'cover' }))
    expect(payload).toContain('\n  ')
    const backup = parseBackup(payload)
    expect(backup.localStorage).toEqual({
      'preferred-quality': '1080',
      'video-fit': 'cover',
      [SNAPSHOT_SENTINEL]: '1',
    })
  })

  it('never writes secrets to the file', () => {
    const payload = snapshotPayload(memoryStorage({
      'preferred-quality': '1080',
      'anilist-token': 'secret-value',
      'subdl-api-key': 'secret-value',
      'debrid-key': 'secret-value',
      'opensubtitles-jwt': 'secret-value',
    }))
    expect(payload).not.toContain('secret-value')
    expect(Object.keys(parseBackup(payload).localStorage).sort())
      .toEqual([SNAPSHOT_SENTINEL, 'preferred-quality'].sort())
  })

  it('round-trips as a normal backup file', () => {
    const payload = snapshotPayload(memoryStorage({ 'video-fit': 'cover' }))
    expect(() => parseBackup(payload)).not.toThrow()
    expect(parseBackup(payload).includesSecrets).toBe(false)
  })
})

describe('storageLooksWiped', () => {
  const snapshot = parseBackup(snapshotPayload(memoryStorage({ 'video-fit': 'cover', 'ui-scale': '1' })))

  it('carries the sentinel inside the snapshot so a restore puts it back', () => {
    expect(snapshot.localStorage[SNAPSHOT_SENTINEL]).toBe('1')
  })

  it('detects storage that lost everything', () => {
    expect(storageLooksWiped(memoryStorage(), snapshot)).toBe(true)
  })

  it('still detects a wipe after persisted stores rewrite their defaults', () => {
    // The regression this exists for. ~25 modules create persisted stores at import time and those
    // stores write defaults into localStorage before recovery can run, so a wiped profile comes
    // back holding most of the snapshot's keys. A presence-based test called that healthy and
    // silently dropped the values the user had actually changed.
    const afterDefaultsRewritten = memoryStorage({
      'video-fit': 'contain',
      'ui-scale': '1',
      PARAGLIDE_LOCALE: 'en',
    })
    expect(storageLooksWiped(afterDefaultsRewritten, snapshot)).toBe(true)
  })

  it('does not fire when the sentinel survived', () => {
    expect(storageLooksWiped(memoryStorage({ [SNAPSHOT_SENTINEL]: '1' }), snapshot)).toBe(false)
  })

  it('does not fire on an empty snapshot', () => {
    const empty = parseBackup(snapshotPayload(memoryStorage()))
    expect(storageLooksWiped(memoryStorage(), empty)).toBe(false)
  })
})

describe('preferenceKeysToWipe', () => {
  let storage: Storage
  beforeEach(() => {
    storage = memoryStorage({
      'video-fit': 'cover',
      'ui-scale': '1',
      'anilist-token': 'keep-me',
      'subdl-api-key': 'keep-me',
      'local-history': 'keep-me',
      'izumi-profile:abc:local-media-library-v1': 'keep-me',
    })
  })

  it('keeps sign-ins and the library, clears the rest', () => {
    expect(preferenceKeysToWipe(storage).sort()).toEqual(['ui-scale', 'video-fit'])
  })

  it('removes only those keys', async () => {
    const cleared = await wipePreferences(storage)
    expect(cleared).toBe(2)
    expect(storage.getItem('video-fit')).toBeNull()
    expect(storage.getItem('ui-scale')).toBeNull()
    expect(storage.getItem('anilist-token')).toBe('keep-me')
    expect(storage.getItem('local-history')).toBe('keep-me')
    expect(storage.getItem('izumi-profile:abc:local-media-library-v1')).toBe('keep-me')
  })
})
