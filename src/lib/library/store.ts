import { invoke } from '@tauri-apps/api/core'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { get, writable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { parseEpisodeFilename, bestMediaMatch, normaliseTitle } from './matching'
import type { LibraryEntry, LibraryMedia, ScannedFile } from './types'

export const libraryFolders = persisted<string[]>('local-library-folders-v1', [])
export const libraryEntries = persisted<Record<string, LibraryEntry>>('local-library-entries-v1', {})
export const libraryScanning = writable(false)
export const libraryScanProgress = writable('')

const searchCache = new Map<string, LibraryMedia[]>()
let lastSearchAt = 0
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

const SEARCH = `query($search:String!){Page(perPage:8){media(type:ANIME,search:$search,sort:SEARCH_MATCH){id idMal title{romaji english userPreferred native} synonyms seasonYear season format episodes coverImage{extraLarge medium color}}}}`

export async function searchLibraryAnime(search: string): Promise<LibraryMedia[]> {
  const value = search.trim()
  if (!value) return []
  const cacheKey = normaliseTitle(value)
  const cached = searchCache.get(cacheKey)
  if (cached) return cached
  // AniList is IP-rate-limited. Large folder scans deliberately trade a little time for reliable
  // matches rather than firing one request per series and leaving the tail unmatched after a 429.
  await sleep(lastSearchAt + 700 - Date.now())
  lastSearchAt = Date.now()
  const response = await httpFetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: SEARCH, variables: { search: value } }),
  })
  if (!response.ok) throw new Error(`AniList search failed (${response.status}).`)
  const json = await response.json() as { data?: { Page?: { media?: LibraryMedia[] } } }
  const media = json.data?.Page?.media ?? []
  searchCache.set(cacheKey, media)
  return media
}

export function guessScannedFile(file: ScannedFile) {
  const guess = parseEpisodeFilename(file.filename)
  if (!/^\d+(?:v\d+)?(?:\.[a-z0-9]+)?$/i.test(file.filename) && guess.title.length > 2) return guess
  const parts = file.path.split(/[\\/]/).filter(Boolean)
  const parent = parts.at(-2) ?? ''
  const seasonFolder = parent.match(/^(?:season|s)\s*(\d{1,2})$/i)
  const titleFolder = seasonFolder ? (parts.at(-3) ?? parent) : parent
  return {
    ...guess,
    title: titleFolder.replace(/[._]+/g, ' ').trim() || guess.title,
    season: guess.season ?? (seasonFolder ? Number(seasonFolder[1]) : undefined),
  }
}

export function addLibraryFolder(path: string) {
  const clean = path.trim()
  if (!clean) return
  libraryFolders.update((folders) => folders.includes(clean) ? folders : [...folders, clean])
}

export function removeLibraryFolder(path: string) {
  libraryFolders.update((folders) => folders.filter((folder) => folder !== path))
}

export function matchLibraryEntry(path: string, media: LibraryMedia, episode?: number) {
  libraryEntries.update((entries) => {
    const entry = entries[path]
    if (!entry) return entries
    return { ...entries, [path]: {
      ...entry, media, mediaId: media.id, episode: episode ?? entry.guess.episode,
      matchConfidence: 1, manuallyMatched: true,
    } }
  })
}

export function setLibraryEpisode(path: string, episode: number) {
  libraryEntries.update((entries) => entries[path]
    ? { ...entries, [path]: { ...entries[path], episode: Math.max(1, Math.floor(episode)) } }
    : entries)
}

export async function scanLibrary(): Promise<LibraryEntry[]> {
  const folders = get(libraryFolders)
  if (!folders.length) return []
  libraryScanning.set(true)
  libraryScanProgress.set('Finding video files…')
  try {
    const files = await invoke<ScannedFile[]>('library_scan', { paths: folders })
    const previous = get(libraryEntries)
    const now = Date.now()
    const entries: LibraryEntry[] = files.map((file) => {
      const old = previous[file.path]
      return {
        ...file,
        guess: guessScannedFile(file),
        media: old?.media,
        mediaId: old?.mediaId,
        episode: old?.episode,
        matchConfidence: old?.matchConfidence,
        manuallyMatched: old?.manuallyMatched,
        scannedAt: now,
      }
    })

    const groups = new Map<string, LibraryEntry[]>()
    for (const entry of entries) {
      if (entry.mediaId) continue
      const key = normaliseTitle(entry.guess.title)
      if (!key) continue
      groups.set(key, [...(groups.get(key) ?? []), entry])
    }
    let completed = 0
    for (const group of groups.values()) {
      const guess = group[0].guess
      libraryScanProgress.set(`Matching ${++completed} of ${groups.size}: ${guess.title}`)
      try {
        const best = bestMediaMatch(guess, await searchLibraryAnime(guess.title))
        if (best && best.confidence >= 0.58) {
          for (const entry of group) {
            entry.media = best.media
            entry.mediaId = best.media.id
            entry.episode = entry.guess.episode
            entry.matchConfidence = best.confidence
          }
        }
      } catch {
        // Preserve the scanned files when matching is offline/rate-limited; users can retry later.
      }
    }
    libraryEntries.set(Object.fromEntries(entries.map((entry) => [entry.path, entry])))
    return entries
  } finally {
    libraryScanning.set(false)
    libraryScanProgress.set('')
  }
}

export function hasLibraryEpisode(mediaId: number, episode: number): boolean {
  return Object.values(get(libraryEntries)).some((entry) => entry.mediaId === mediaId && entry.episode === episode)
}
