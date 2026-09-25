// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get, writable, type Writable } from 'svelte/store'

const mocks = vi.hoisted(() => ({ extensionUrls: null as unknown as Writable<string[]> }))
vi.mock('$lib/settings/ui', () => {
  mocks.extensionUrls = writable<string[]>([])
  return { extensionUrls: mocks.extensionUrls }
})

import { OFFICIAL_ANIME_CATALOG } from '$lib/extensions/catalog'
import {
  currentLegacyStores, forgetPackageOrigin, legacyPackageStores, legacyStoresFrom, mayReplacePackage, originKey,
  packageOrigins, recordPackageOrigin,
} from './origins'

const CATALOG = 'https://catalog.example.test/index.json'
const LATER = 'https://later.example.test/index.json'

beforeEach(() => {
  mocks.extensionUrls.set([])
  packageOrigins.set({})
  legacyPackageStores.set(null)
})

describe('package origins', () => {
  it('remembers and forgets which store a package came from, by canonical URL', () => {
    recordPackageOrigin('example.pkg', `${CATALOG}#top`)
    expect(get(packageOrigins)).toEqual({ 'example.pkg': CATALOG })
    forgetPackageOrigin('example.pkg')
    expect(get(packageOrigins)).toEqual({})
  })

  it('compares specs by their canonical URL, and anything else as written', () => {
    expect(originKey('https://catalog.example.test/a/../index.json')).toBe(CATALOG)
    expect(originKey('gh:someone/catalog')).toBe('gh:someone/catalog')
  })
})

describe('legacy stores', () => {
  it('freezes the official catalog and the source list the first time, and never grows', () => {
    mocks.extensionUrls.set([CATALOG])
    expect(currentLegacyStores()).toEqual([OFFICIAL_ANIME_CATALOG, CATALOG])
    // A catalog added later — even one a Store install puts in the source list — gains no claim.
    mocks.extensionUrls.set([CATALOG, LATER])
    expect(currentLegacyStores()).toEqual([OFFICIAL_ANIME_CATALOG, CATALOG])
    expect(get(legacyPackageStores)).toEqual([OFFICIAL_ANIME_CATALOG, CATALOG])
  })

  it('drops a frozen catalog once it leaves the source list, but never the official one', () => {
    expect(legacyStoresFrom([OFFICIAL_ANIME_CATALOG, CATALOG], [])).toEqual([OFFICIAL_ANIME_CATALOG])
    expect(legacyStoresFrom(null, [CATALOG])).toEqual([])
  })

  it('lets an installed package change only through its own store, or a legacy store when it has none', () => {
    mocks.extensionUrls.set([CATALOG])
    expect(mayReplacePackage('old.pkg', CATALOG)).toBe(true)
    expect(mayReplacePackage('old.pkg', OFFICIAL_ANIME_CATALOG)).toBe(true)
    // A legacy claim never changes what kind of package it is.
    expect(mayReplacePackage('old.pkg', CATALOG, false)).toBe(false)
    mocks.extensionUrls.set([CATALOG, LATER])
    expect(mayReplacePackage('old.pkg', LATER)).toBe(false)
    recordPackageOrigin('bound.pkg', LATER)
    expect(mayReplacePackage('bound.pkg', LATER)).toBe(true)
    expect(mayReplacePackage('bound.pkg', LATER, false)).toBe(true)
    expect(mayReplacePackage('bound.pkg', CATALOG)).toBe(false)
    expect(mayReplacePackage('constructor', LATER)).toBe(false)
  })
})
