import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('catalog detail trailer action', () => {
  const detail = read('./CatalogMediaDetail.svelte')

  it('opens available movie and series trailers inside the client', () => {
    expect(detail).toContain("import Clapperboard from '@lucide/svelte/icons/clapperboard'")
    expect(detail).toContain("import { openTrailerPopup } from '$lib/stores/trailer'")
    expect(detail).toContain('{#if media.trailer?.id}')
    expect(detail).toContain('aria-label="Watch trailer"')
    expect(detail).toContain('openTrailerPopup(media.trailer.id, `${title(media)} trailer`)')
    expect(detail).toContain('onclick={watchTrailer}')
  })

  it('receives trailer ids from both rich metadata providers', () => {
    expect(read('../../catalog/providers/tmdb.ts')).toContain("media.trailer = trailer?.key ? { id: trailer.key, site: 'youtube', language: trailer.iso_639_1 } : null")
    expect(read('../../catalog/providers/stremio.ts')).toContain("? { id: raw.trailers.find((trailer) => trailer.source)!.source, site: 'youtube' }")
  })
})
