export interface ScannedFile {
  path: string
  filename: string
  size: number
  modifiedAt?: number
}

export interface EpisodeGuess {
  title: string
  season?: number
  episode?: number
  confidence: number
}

export interface LibraryMedia {
  id: number
  idMal?: number | null
  title: { romaji?: string | null; english?: string | null; userPreferred?: string | null; native?: string | null }
  synonyms?: string[]
  seasonYear?: number | null
  season?: string | null
  format?: string | null
  episodes?: number | null
  coverImage?: { extraLarge?: string | null; medium?: string | null; color?: string | null }
}

export interface LibraryEntry extends ScannedFile {
  guess: EpisodeGuess
  media?: LibraryMedia
  mediaId?: number
  episode?: number
  matchConfidence?: number
  manuallyMatched?: boolean
  scannedAt: number
}
