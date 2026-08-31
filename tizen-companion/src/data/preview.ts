import type { CompanionEpisode, CompanionHomeSnapshot, CompanionMedia } from '../types'

const media = (
  id: number,
  title: string,
  poster: string,
  options: Partial<CompanionMedia> = {},
): CompanionMedia => ({
  ref: { provider: 'anilist', id: String(id), type: 'anime' },
  title,
  poster,
  ...options,
})

const frierenSeasonOneTitles = [
  "The Journey's End",
  "It Didn't Have to Be Magic...",
  'Killing Magic',
  'The Land Where Souls Rest',
  'Phantoms of the Dead',
  'The Hero of the Village',
  'Like a Fairy Tale',
  'Frieren the Slayer',
  'Aura the Guillotine',
  'A Powerful Mage',
  'Winter in the Northern Lands',
  'A Real Hero',
  "Aversion to One's Own Kind",
  'Privilege of the Young',
  'Smells Like Trouble',
  'Long-Lived Friends',
  'Take Care',
  'First-Class Mage Exam',
  'Well-Laid Plans',
  'Necessary Killing',
  'The World of Magic',
  'Future Enemies',
  'Conquering the Labyrinth',
  'Perfect Replicas',
  'A Fatal Vulnerability',
  'The Height of Magic',
  'An Era of Humans',
  'It Would Be Embarrassing When We Met Again',
]

const frierenEpisodeDescriptions = [
  'After fifty years apart, Frieren reunites with her former companions and begins to reckon with the passage of time.',
  'Frieren takes Fern as her apprentice while searching for the flowers Himmel once loved.',
  'A remnant of Qual’s killing magic forces Frieren to confront a spell from the past.',
  'Frieren and Fern head north toward the place where souls are said to rest.',
  'The travellers enter a village haunted by phantoms that prey on treasured memories.',
  'Frieren and Fern meet Stark, a young warrior living beneath a dragon’s shadow.',
  'A festival remembers Himmel while demons arrive with a request for peace.',
  'Frieren reveals why demons still remember her name.',
  'Fern and Stark face Lugner and Linie as Frieren confronts Aura.',
  'Aura’s army closes in, but the balance of mana is not what it seems.',
  'The party takes shelter from the northern winter and learns to travel together.',
  'Stark’s past catches up with him as the group encounters his older brother’s legacy.',
]

const frierenEpisodes: CompanionEpisode[] = frierenSeasonOneTitles.map((title, index) => ({
  season: 1,
  episode: index + 1,
  title,
  description: frierenEpisodeDescriptions[index] ?? 'Frieren, Fern and Stark continue their journey through the northern lands.',
  image: index === 11 ? 'https://artworks.thetvdb.com/banners/v4/episode/9993747/screencap/655ccc7b3af99.jpg' : undefined,
  runtimeMinutes: 25,
  watched: index < 11,
  progress: index === 11 ? .64 : index < 11 ? 1 : 0,
}))

const frierenSeasonTwo = media(
  182255,
  "Frieren: Beyond Journey's End Season 2",
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx182255-butzrqd4I0aC.jpg',
  {
    subtitle: '2026 · 10 Episodes · Fantasy',
    backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/182255-wyHvp6zJbWsO.jpg',
    season: 2,
    seasonEpisodeCounts: [10],
    seasonLabels: ['Season 2'],
  },
)

const frierenMagic = media(
  170068,
  'Frieren: Magic Shorts',
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx170068-ijY3tCP8KoWP.jpg',
  { subtitle: '2023 · 12 Episodes · Short-form side story', seasonEpisodeCounts: [12], seasonLabels: ['Shorts'] },
)

const frierenMagicPartTwo = media(
  189513,
  'Frieren: Magic Shorts Part 2',
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx189513-1R9Sryve0K53.png',
  {
    subtitle: '2025 · 6 Episodes · Short-form side story',
    backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/189513-HjE2qNupgfEe.jpg',
    seasonEpisodeCounts: [6],
    seasonLabels: ['Shorts · Part 2'],
  },
)

const frieren = media(
  154587,
  "Frieren: Beyond Journey's End",
  'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-qQTzQnEJJ3oB.jpg',
  {
    subtitle: '2023 · 28 Episodes · Fantasy',
    description: 'Decades after the hero party defeated the Demon King, an elven mage begins a new journey to understand the people she once travelled beside.',
    backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/154587-ivXNJ23SM1xB.jpg',
    trailer: { id: 'Iwr1aLEDpe4', site: 'youtube' },
    contentRating: 'TV-14',
    placement: { label: 'Top Rated This Season', position: 1, kind: 'ranking' },
    progress: 0.42,
    episode: 12,
    seasonEpisodeCounts: [28, 10],
    seasonLabels: ['Season 1', 'Season 2'],
    episodes: frierenEpisodes,
    relations: [
      { relationType: 'SEQUEL', media: frierenSeasonTwo },
      { relationType: 'SIDE_STORY', media: frierenMagic },
      { relationType: 'SIDE_STORY', media: frierenMagicPartTwo },
    ],
  },
)

const relationSummary = (item: CompanionMedia): CompanionMedia => {
  const { relations: _relations, ...summary } = item
  return summary
}

frierenSeasonTwo.relations = [
  { relationType: 'PREQUEL', media: relationSummary(frieren) },
  { relationType: 'SIDE_STORY', media: relationSummary(frierenMagic) },
  { relationType: 'SIDE_STORY', media: relationSummary(frierenMagicPartTwo) },
]
frierenMagic.relations = [
  { relationType: 'PARENT', media: relationSummary(frieren) },
  { relationType: 'SEQUEL', media: relationSummary(frierenMagicPartTwo) },
]
frierenMagicPartTwo.relations = [
  { relationType: 'PARENT', media: relationSummary(frieren) },
  { relationType: 'PREQUEL', media: relationSummary(frierenMagic) },
]

const popular = [
  frieren,
  media(16498, 'Attack on Titan', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx16498-buvcRTBx4NSm.jpg', { subtitle: '2013 · 25 Episodes · Action', backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/16498-8jpFCOcDmneX.jpg', progress: 0.68, episode: 18, seasonEpisodeCounts: [25, 12, 22, 35], placement: { label: 'Continue Watching', kind: 'continue' } }),
  media(113415, 'Jujutsu Kaisen', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx113415-LHBAeoZDIsnF.jpg', { subtitle: '2020 · 24 Episodes · Supernatural', backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/113415-jQBSkxWAAk83.jpg', seasonEpisodeCounts: [24, 23], placement: { label: 'Trending Now', position: 3, kind: 'ranking' } }),
  media(127230, 'Chainsaw Man', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx127230-DdP4vAdssLoz.png', { subtitle: '2022 · 12 Episodes · Action', backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/127230-o8IRwCGVr9KW.jpg', seasonEpisodeCounts: [12], placement: { label: 'Trending Now', position: 4, kind: 'ranking' } }),
  media(151807, 'Solo Leveling', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx151807-it355ZgzquUd.png', { subtitle: '2024 · 12 Episodes · Fantasy', backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/151807-37yfQA3ym8PA.jpg', seasonEpisodeCounts: [12, 13], placement: { label: 'Popular This Week', position: 2, kind: 'ranking' } }),
  media(21, 'One Piece', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21-ELSYx3yMPcKM.jpg', { subtitle: '1999 · Adventure', backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/21-wf37VakJmZqs.jpg', seasonEpisodeCounts: [61, 16, 15, 38] }),
  media(269, 'Bleach', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx269-d2GmRkJbMopq.png', { subtitle: '2004 · Action', backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/269-08ar2HJOUAuL.jpg', seasonEpisodeCounts: [20, 21, 22, 28] }),
  media(11061, 'Hunter × Hunter', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx11061-y5gsT1hoHuHw.png', { subtitle: '2011 · Adventure', backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/11061-8WkkTZ6duKpq.jpg', seasonEpisodeCounts: [26, 27, 22, 17] }),
  media(1535, 'Death Note', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1535-kUgkcrfOrkUM.jpg', { subtitle: '2006 · Thriller', backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/1535.jpg', seasonEpisodeCounts: [37] }),
  media(101922, 'Demon Slayer', 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx101922-WBsBl0ClmgYL.jpg', { subtitle: '2019 · Action', backdrop: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/101922-33MtJGsUSxga.jpg', seasonEpisodeCounts: [26, 18, 11, 8] }),
]

const continueItems: CompanionMedia[] = [
  {
    ...frieren,
    episode: 12,
    season: 1,
    episodeTitle: 'A Real Hero',
    episodeImage: 'https://artworks.thetvdb.com/banners/v4/episode/9993747/screencap/655ccc7b3af99.jpg',
    episodeProgress: .64,
    episodeRuntimeMinutes: 25,
  },
  {
    ...popular[1],
    episode: 18,
    season: 1,
    episodeTitle: 'Forest of Giant Trees',
    episodeImage: 'https://artworks.thetvdb.com/banners/episodes/267440/4546801.jpg',
    episodeProgress: .28,
    episodeRuntimeMinutes: 24,
  },
  {
    ...popular[2],
    progress: .33,
    episode: 9,
    season: 1,
    episodeTitle: 'Small Fry and Reverse Retribution',
    episodeImage: 'https://artworks.thetvdb.com/banners/series/377543/episodes/5fbdb3b779977.jpg',
    episodeProgress: .54,
    episodeRuntimeMinutes: 24,
  },
  {
    ...popular[3],
    progress: .75,
    episode: 10,
    season: 1,
    episodeTitle: 'Bruised & Battered',
    episodeImage: 'https://artworks.thetvdb.com/banners/v4/episode/9358685/screencap/63983975c2a09.jpg',
    episodeProgress: .72,
    episodeRuntimeMinutes: 24,
  },
  {
    ...popular[4],
    progress: .2,
    episode: 3,
    season: 1,
    episodeTitle: "It's Like a Game",
    episodeImage: 'https://artworks.thetvdb.com/banners/v4/episode/10190442/screencap/65a96e7108c25.jpg',
    episodeProgress: .17,
    episodeRuntimeMinutes: 24,
  },
]

const placed = (items: CompanionMedia[], label: string, kind: 'continue' | 'ranking' | 'catalog') =>
  items.map((item, index) => ({
    ...item,
    placement: { label, position: kind === 'continue' ? undefined : index + 1, kind },
  }))

export const previewSnapshot: CompanionHomeSnapshot = {
  app: 'izumi',
  kind: 'companion-home',
  version: 1,
  revision: 'local-preview',
  generatedAt: Date.now(),
  catalog: {
    screen: 'auto',
    label: 'Automatic anime',
    options: [
      { screen: 'auto', label: 'Automatic anime' },
      { screen: 'anilist', label: 'AniList' },
      { screen: 'stremio', label: 'Stremio' },
      { screen: 'merged', label: 'Merged' },
    ],
  },
  hero: frieren,
  rows: [
    { id: 'continue', title: 'Continue Watching', kind: 'continue', items: placed(continueItems, 'Continue Watching', 'continue') },
    { id: 'popular', title: 'Popular This Week', kind: 'catalog', items: placed(popular.slice(3).concat(popular.slice(0, 3)), 'Popular This Week', 'ranking') },
    { id: 'classics', title: 'Modern Classics', kind: 'catalog', items: placed(popular.slice(6).concat(popular.slice(0, 6)), 'Modern Classics', 'catalog') },
  ],
}

export function previewSnapshotForCatalog(screen: string): CompanionHomeSnapshot {
  const selectedOption = previewSnapshot.catalog.options?.find((option) => option.screen === screen)
  if (screen !== 'stremio') {
    return {
      ...previewSnapshot,
      revision: `local-preview-${screen}`,
      catalog: {
        ...previewSnapshot.catalog,
        screen,
        label: selectedOption?.label ?? previewSnapshot.catalog.label,
      },
    }
  }

  const topTenLabel = 'Top 10 on Stremio today'
  const stremioRanked = popular.map((item) => ({
    ...item,
    progress: undefined,
    episode: undefined,
    season: undefined,
    episodeTitle: undefined,
    episodeImage: undefined,
    episodeProgress: undefined,
    episodeRuntimeMinutes: undefined,
  }))
  return {
    ...previewSnapshot,
    revision: 'local-preview-stremio',
    catalog: {
      ...previewSnapshot.catalog,
      screen: 'stremio',
      label: 'Stremio',
    },
    hero: {
      ...stremioRanked[0],
      placement: { label: topTenLabel, position: 1, kind: 'ranking' },
    },
    rows: [
      {
        id: 'stremio-top-ten',
        title: topTenLabel,
        kind: 'catalog',
        presentation: 'top-10',
        items: placed(stremioRanked, topTenLabel, 'ranking'),
      },
      {
        id: 'stremio-continue',
        title: 'Continue Watching',
        kind: 'continue',
        items: placed(continueItems, 'Continue Watching', 'continue'),
      },
      {
        id: 'stremio-popular-series',
        title: 'Popular series from your add-ons',
        kind: 'catalog',
        items: placed(popular.slice(4).concat(popular.slice(0, 4)), 'Popular series from your add-ons', 'catalog'),
      },
    ],
  }
}
