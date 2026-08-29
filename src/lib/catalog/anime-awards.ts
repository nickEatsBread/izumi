export interface AnimeAwardWin {
  year: number
  category: string
  title: string
}

// A compact winner index is deliberately kept local: award recognition must remain instant and
// must not scrape an editorial page while Home is rendering. New ceremonies can be appended here.
const WINNERS: AnimeAwardWin[] = [
  { year: 2017, category: 'Anime of the Year', title: 'Yuri on Ice' },
  { year: 2018, category: 'Anime of the Year', title: 'Made in Abyss' },
  { year: 2019, category: 'Anime of the Year', title: 'Devilman Crybaby' },
  { year: 2020, category: 'Anime of the Year', title: 'Demon Slayer: Kimetsu no Yaiba' },
  { year: 2021, category: 'Anime of the Year', title: 'Jujutsu Kaisen' },
  { year: 2022, category: 'Anime of the Year', title: 'Attack on Titan: The Final Season Part 1' },
  { year: 2023, category: 'Anime of the Year', title: 'Cyberpunk: Edgerunners' },
  { year: 2024, category: 'Anime of the Year', title: 'Jujutsu Kaisen' },
  { year: 2025, category: 'Anime of the Year', title: 'Solo Leveling' },
  { year: 2026, category: 'Anime of the Year', title: 'My Hero Academia: Final Season' },

  { year: 2018, category: 'Film of the Year', title: 'Your Name' },
  { year: 2019, category: 'Film of the Year', title: 'My Hero Academia: Two Heroes' },
  { year: 2022, category: 'Film of the Year', title: 'Demon Slayer: Kimetsu no Yaiba – The Movie: Mugen Train' },
  { year: 2023, category: 'Film of the Year', title: 'Jujutsu Kaisen 0' },
  { year: 2024, category: 'Film of the Year', title: 'Suzume' },
  { year: 2025, category: 'Film of the Year', title: 'Look Back' },
  { year: 2026, category: 'Film of the Year', title: 'Demon Slayer: Kimetsu no Yaiba – The Movie: Infinity Castle' },

  { year: 2025, category: 'Best Continuing Series', title: 'Demon Slayer: Kimetsu no Yaiba Hashira Training Arc' },
  { year: 2025, category: 'Best New Series', title: 'Solo Leveling' },
  { year: 2025, category: 'Best Animation', title: 'Demon Slayer: Kimetsu no Yaiba Hashira Training Arc' },
  { year: 2025, category: 'Best Drama', title: 'Frieren: Beyond Journey’s End' },
  { year: 2025, category: 'Best Action', title: 'Solo Leveling' },
  { year: 2025, category: 'Best Comedy', title: 'Mashle: Magic and Muscles The Divine Visionary Candidate Exam Arc' },
  { year: 2025, category: 'Best Romance', title: 'Blue Box' },
  { year: 2025, category: 'Best Original Anime', title: 'Ninja Kamui' },

  { year: 2026, category: 'Best Continuing Series', title: 'One Piece' },
  { year: 2026, category: 'Best New Series', title: 'Gachiakuta' },
  { year: 2026, category: 'Best Original Anime', title: 'Lazarus' },
  { year: 2026, category: 'Best Animation', title: 'Solo Leveling Season 2: Arise from the Shadow' },
  { year: 2026, category: 'Best Character Design', title: 'Gachiakuta' },
  { year: 2026, category: 'Best Director', title: 'The Apothecary Diaries Season 2' },
  { year: 2026, category: 'Best Background Art', title: 'Gachiakuta' },
  { year: 2026, category: 'Best Romance', title: 'The Fragrant Flower Blooms with Dignity' },
  { year: 2026, category: 'Best Comedy', title: 'Dandadan Season 2' },
  { year: 2026, category: 'Best Action', title: 'Solo Leveling Season 2: Arise from the Shadow' },
  { year: 2026, category: 'Best Isekai', title: 'Re:Zero -Starting Life in Another World- Season 3' },
  { year: 2026, category: 'Best Drama', title: 'The Apothecary Diaries Season 2' },
  { year: 2026, category: 'Best Slice of Life', title: 'Spy x Family Season 3' },
  { year: 2026, category: 'Best Anime Song', title: 'Chainsaw Man – The Movie: Reze Arc' },
  { year: 2026, category: 'Best Score', title: 'Demon Slayer: Kimetsu no Yaiba – The Movie: Infinity Castle' },
  { year: 2026, category: 'Best Opening Sequence', title: 'Dandadan Season 2' },
  { year: 2026, category: 'Best Ending Sequence', title: 'My Hero Academia: Final Season' },
]

export function normalizeAwardTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[×]/g, 'x')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/\b(?:the )?movie\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\bdan da dan\b/g, 'dandadan')
}

const INDEX = WINNERS.reduce((map, win) => {
  const key = normalizeAwardTitle(win.title)
  map.set(key, [...(map.get(key) ?? []), win])
  return map
}, new Map<string, AnimeAwardWin[]>())

const categoryRank = (category: string) => category === 'Anime of the Year' ? 0
  : category === 'Film of the Year' ? 1 : 2

export function findAnimeAwardWins(name: string): AnimeAwardWin[] {
  const key = normalizeAwardTitle(name)
  const direct = INDEX.get(key)
  // TMDB commonly models a long-running anime as one series while an award names its season or
  // film. A one-way title prefix is a conservative franchise bridge; arbitrary fuzzy matching is
  // intentionally avoided so unrelated titles never acquire an award badge.
  const matches = direct ?? WINNERS.filter((win) => {
    const winnerKey = normalizeAwardTitle(win.title)
    return winnerKey.startsWith(`${key} `) || key.startsWith(`${winnerKey} `)
  })
  return [...matches].sort((left, right) =>
    categoryRank(left.category) - categoryRank(right.category)
    || right.year - left.year
    || left.category.localeCompare(right.category))
}

export function findTopAnimeAward(name: string): AnimeAwardWin | null {
  return findAnimeAwardWins(name)[0] ?? null
}
