import { describe, expect, it } from 'vitest'
import { editDistance, normalizeTitle, RELEVANT_MATCH, STRONG_MATCH, titleMatchScore } from './title-match'

describe('normalizeTitle', () => {
  it('folds case, accents, punctuation and apostrophes', () => {
    expect(normalizeTitle('Pokémon')).toBe('pokemon')
    expect(normalizeTitle("Hell's Paradise")).toBe('hells paradise')
    expect(normalizeTitle('Steins;Gate')).toBe('steins gate')
    expect(normalizeTitle('Re:ZERO -Starting Life in Another World-')).toBe('re zero starting life in another world')
  })

  it('spells a multiplication-sign title the way people type it', () => {
    expect(normalizeTitle('SPY×FAMILY')).toBe('spy x family')
    expect(normalizeTitle('HUNTER×HUNTER')).toBe('hunter x hunter')
  })

  it('writes the words titles abbreviate the way the titles do', () => {
    expect(normalizeTitle('Kaiju Number 8')).toBe('kaiju no 8')
    expect(normalizeTitle('Doctor Stone')).toBe('dr stone')
    expect(normalizeTitle('Spice & Wolf')).toBe('spice and wolf')
  })
})

describe('editDistance', () => {
  it('counts a swap of neighbouring letters as one edit', () => {
    expect(editDistance('freiren', 'frieren', 2)).toBe(1)
    expect(editDistance('jujustu', 'jujutsu', 2)).toBe(1)
  })

  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('titain', 'titan', 2)).toBe(1)
    expect(editDistance('academy', 'academia', 2)).toBe(2)
    expect(editDistance('same', 'same', 2)).toBe(0)
  })

  it('stops at the bound', () => {
    expect(editDistance('attack', 'shingeki', 2)).toBe(3)
    expect(editDistance('a', 'abcdef', 1)).toBe(2)
  })
})

describe('titleMatchScore', () => {
  const relevant = (query: string, title: string) => expect(titleMatchScore(query, title)).toBeGreaterThanOrEqual(RELEVANT_MATCH)
  const strong = (query: string, title: string) => expect(titleMatchScore(query, title)).toBeGreaterThanOrEqual(STRONG_MATCH)
  const unrelated = (query: string, title: string) => expect(titleMatchScore(query, title)).toBeLessThan(RELEVANT_MATCH)

  it('scores an exact title highest', () => {
    expect(titleMatchScore('frieren', 'Frieren')).toBe(1)
    expect(titleMatchScore('Frieren', 'Frieren: Beyond Journey’s End')).toBeLessThan(1)
  })

  it('ignores where the spaces fall', () => {
    strong('onepiece', 'One Piece')
    strong('umamusume', 'Uma Musume: Pretty Derby')
    strong('uma musume', 'Umamusume: Pretty Derby')
    strong('tora dora', 'Toradora!')
    strong('steinsgate', 'Steins;Gate')
    strong('hunterxhunter', 'Hunter x Hunter (2011)')
    strong('oshinoko', 'Oshi no Ko')
    strong('madeinabyss', 'Made in Abyss')
  })

  it('forgives a typo or two in a word', () => {
    relevant('freiren', 'Frieren: Beyond Journey’s End')
    strong('attack on titain', 'Attack on Titan')
    strong('jujustu kaisen', 'Jujutsu Kaisen')
    strong('my hero acadamia', 'My Hero Academia')
    strong('naruto shipuden', 'Naruto: Shippuden')
    strong('mob pyscho 100', 'Mob Psycho 100')
    strong('solo levelling', 'Solo Leveling')
    strong('sololeveling', 'Solo Leveling')
    relevant('chainsaw men', 'Chainsaw Man')
    relevant('boku no hero academy', 'Boku no Hero Academia')
  })

  it('matches the word still being typed as a prefix', () => {
    relevant('frier', 'Sousou no Frieren')
    relevant('jujut', 'Jujutsu Kaisen')
    relevant('attack on ti', 'Attack on Titan')
  })

  it('matches titles written with abbreviations or punctuation', () => {
    expect(titleMatchScore('kaiju number 8', 'Kaiju No. 8')).toBe(1)
    expect(titleMatchScore('doctor stone', 'Dr. STONE')).toBe(1)
    expect(titleMatchScore('hells paradise', "Hell's Paradise")).toBe(1)
    expect(titleMatchScore('spy x family', 'SPY×FAMILY')).toBe(1)
    expect(titleMatchScore('pokemon', 'Pokémon')).toBe(1)
  })

  it('finds a glued query inside a longer title', () => {
    relevant('bluelock movie', 'Blue Lock the Movie -Episode Nagi-')
  })

  it('gives unrelated titles nothing', () => {
    expect(titleMatchScore('freiren', 'You Shou Yan 6th Season')).toBe(0)
    expect(titleMatchScore('freiren', 'Haru')).toBe(0)
    unrelated('tora dora', 'Ushio and Tora')
    unrelated('dragon ball', 'Dragon Half')
    unrelated('one piece', 'One Punch Man')
    unrelated('on', 'no')
    unrelated('kimi no nawa', 'Sunny Ryoko! You Were There in a Dream')
  })

  it('does not piece a query together from common words scattered through a long title', () => {
    unrelated('kimi no nawa', 'Hiatari Ryoukou! Yume no Naka ni Kimi ga Ita')
  })

  it('allows two typos only in long words', () => {
    unrelated('oshinoko', 'Oshiruko')
    relevant('fullmetal alchemist brotherhod', 'Fullmetal Alchemist: Brotherhood')
  })

  it('never lets a typo change a number', () => {
    expect(titleMatchScore('jujutsu kaisen 2', 'Jujutsu Kaisen Season 2'))
      .toBeGreaterThan(titleMatchScore('jujutsu kaisen 2', 'Jujutsu Kaisen 0'))
    unrelated('2011', '2012')
  })

  it('prefers the closer of two titles that both contain the query', () => {
    expect(titleMatchScore('demon slayer', 'Demon Slayer: Kimetsu no Yaiba'))
      .toBeGreaterThan(titleMatchScore('demon slayer', 'Demon Slayer -Kimetsu no Yaiba- The Movie: Mugen Train'))
    expect(titleMatchScore('chainsaw man', 'Chainsaw Man'))
      .toBeGreaterThan(titleMatchScore('chainsaw man', 'Chainsaw Maid'))
  })

  it('matches scripts written without spaces by containment', () => {
    relevant('進撃', '進撃の巨人')
    relevant('巨人', '進撃の巨人')
    unrelated('巨人', 'ウマ娘 プリティーダービー')
  })

  it('matches spaced scripts word by word, not inside other words', () => {
    unrelated('ран', 'Бураново')
    unrelated('ник', 'Хроники Акаши')
    strong('хроники', 'Хроники Акаши')
    relevant('хрони', 'Хроники Акаши')
  })

  it('scores an empty query or title as no match', () => {
    expect(titleMatchScore('', 'Frieren')).toBe(0)
    expect(titleMatchScore('frieren', '')).toBe(0)
  })
})
