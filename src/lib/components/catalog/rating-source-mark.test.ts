import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const mark = readFileSync(fileURLToPath(new URL('./RatingSourceMark.svelte', import.meta.url)), 'utf8')
const ratings = readFileSync(fileURLToPath(new URL('./MediaRatings.svelte', import.meta.url)), 'utf8')

describe('rating source mark', () => {
  it('uses bundled provider artwork before the numeric score', () => {
    expect(mark).toContain('/brand/anilist.svg')
    expect(mark).toContain('/brand/myanimelist.svg')
    expect(mark).toContain('/brand/metacritic.svg')
    expect(mark).not.toContain("source === 'Metacritic' ? 'MC'")
    expect(mark).toContain('themoviedb.org/assets/v4/logos/v2/blue_square_2-')
    expect(mark).toContain('avatars.githubusercontent.com/u/7648832')
    expect(mark).toContain('simkl.com/favicon.ico')
    expect(ratings).toMatch(/<RatingSourceMark[^]*?compact \? compactRatingLabel\(rating\)/)
    expect(ratings).not.toContain('@lucide/svelte/icons/star')
  })
})
