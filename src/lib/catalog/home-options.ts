import type { CatalogHomeRowOption } from './types'

/** Local rows can appear on every catalog home without asking its metadata provider. */
export const CONTINUE_HOME_ROW: CatalogHomeRowOption = {
  id: 'continue',
  title: 'Continue Watching',
  description: 'Resume titles from your watch history.',
  group: 'Your library',
  defaultEnabled: true,
}

export const ANILIST_HOME_ROWS: CatalogHomeRowOption[] = [
  CONTINUE_HOME_ROW,
  { id: 'recent', title: 'Recently Released', description: 'Episodes released in the last few days.', group: 'Your anime', defaultEnabled: false },
  { id: 'list', title: 'Your List', description: 'Planned titles from your connected tracker.', group: 'Your anime', defaultEnabled: true },
  { id: 'recommendations', title: 'Recommended for You', description: 'Suggestions ranked locally from your watch history and connected AniList account.', group: 'Your anime', defaultEnabled: true },
  { id: 'season', title: 'Popular This Season', description: 'The most popular anime in the current season.', group: 'Discover', defaultEnabled: true },
  { id: 'trending', title: 'Trending Now', description: 'Anime receiving the most attention right now.', group: 'Discover', defaultEnabled: true },
  { id: 'popular', title: 'All Time Popular', description: 'The most popular anime across AniList.', group: 'Discover', defaultEnabled: true },
  { id: 'romance', title: 'Romance', description: 'Trending romance anime.', group: 'Genres', defaultEnabled: true },
  { id: 'action', title: 'Action', description: 'Trending action anime.', group: 'Genres', defaultEnabled: true },
  { id: 'fantasy', title: 'Fantasy', description: 'Trending fantasy anime.', group: 'Genres', defaultEnabled: true },
]

export const KITSU_HOME_ROWS: CatalogHomeRowOption[] = [
  CONTINUE_HOME_ROW,
  { id: 'season', title: 'Popular This Season', description: 'Popular anime from the current season.', group: 'Discover', defaultEnabled: true },
  { id: 'trending', title: 'Airing Now', description: 'Popular anime that are currently airing.', group: 'Discover', defaultEnabled: true },
  { id: 'popular', title: 'All Time Popular', description: 'Anime with the largest Kitsu audiences.', group: 'Discover', defaultEnabled: true },
  { id: 'rated', title: 'Highest Rated', description: 'Anime with the strongest Kitsu ratings.', group: 'Discover', defaultEnabled: true },
  { id: 'action', title: 'Action', description: 'Popular action anime.', group: 'Genres', defaultEnabled: true },
  { id: 'romance', title: 'Romance', description: 'Popular romance anime.', group: 'Genres', defaultEnabled: true },
]

/** TMDB exposes many list endpoints and a broad discover API. The shipped home stays focused;
 * the remaining presets are opt-in so enabling TMDB does not immediately fire 30 requests. */
export const TMDB_HOME_ROWS: CatalogHomeRowOption[] = [
  CONTINUE_HOME_ROW,
  { id: 'trending', title: 'Trending This Week', description: 'Movies and TV gaining attention across TMDB this week.', group: 'Trending', defaultEnabled: true },
  { id: 'top10-movies', title: 'Top 10 Movies Streaming in Your Region', description: 'The most popular movies available to stream where you are.', group: 'Featured', defaultEnabled: true },
  { id: 'streaming-providers', title: 'Your Streaming', description: 'Browse the services available in your region.', group: 'Featured', defaultEnabled: true },
  { id: 'anime-series', title: 'Popular Anime Series', description: 'Japanese animated series ordered by popularity.', group: 'Anime', defaultEnabled: true },
  { id: 'anime-movies', title: 'Popular Anime Movies', description: 'Japanese animated movies ordered by popularity.', group: 'Anime', defaultEnabled: true },
  { id: 'movies', title: 'Popular Movies', description: 'Movies ordered by TMDB popularity.', group: 'Movies', defaultEnabled: true },
  { id: 'series', title: 'Popular Series', description: 'Television ordered by TMDB popularity.', group: 'TV series', defaultEnabled: true },
  { id: 'rated-movies', title: 'Top Rated Movies', description: 'The highest-rated movies with a meaningful vote count.', group: 'Movies', defaultEnabled: true },
  { id: 'rated-series', title: 'Top Rated Series', description: 'The highest-rated television with a meaningful vote count.', group: 'TV series', defaultEnabled: true },
  { id: 'upcoming', title: 'Upcoming Movies', description: 'Movies being released soon.', group: 'Movies', defaultEnabled: true },

  { id: 'trending-today', title: 'Trending Today', description: 'Movies and TV gaining attention today.', group: 'Trending', defaultEnabled: false },
  { id: 'trending-movies', title: 'Trending Movies This Week', description: 'This week’s trending movies.', group: 'Trending', defaultEnabled: false },
  { id: 'trending-movies-today', title: 'Trending Movies Today', description: 'Today’s trending movies.', group: 'Trending', defaultEnabled: false },
  { id: 'trending-series', title: 'Trending Series This Week', description: 'This week’s trending television.', group: 'Trending', defaultEnabled: false },
  { id: 'trending-series-today', title: 'Trending Series Today', description: 'Today’s trending television.', group: 'Trending', defaultEnabled: false },

  { id: 'now-playing', title: 'Now Playing in Cinemas', description: 'Movies currently in theatrical release.', group: 'Movies', defaultEnabled: false },
  { id: 'action-movies', title: 'Action Movies', description: 'Popular action movies.', group: 'Movie genres', defaultEnabled: false },
  { id: 'adventure-movies', title: 'Adventure Movies', description: 'Popular adventure movies.', group: 'Movie genres', defaultEnabled: false },
  { id: 'comedy-movies', title: 'Comedy Movies', description: 'Popular comedy movies.', group: 'Movie genres', defaultEnabled: false },
  { id: 'crime-movies', title: 'Crime Movies', description: 'Popular crime movies.', group: 'Movie genres', defaultEnabled: false },
  { id: 'documentary-movies', title: 'Documentaries', description: 'Popular documentary films.', group: 'Movie genres', defaultEnabled: false },
  { id: 'family-movies', title: 'Family Movies', description: 'Popular family movies.', group: 'Movie genres', defaultEnabled: false },
  { id: 'fantasy-movies', title: 'Fantasy Movies', description: 'Popular fantasy movies.', group: 'Movie genres', defaultEnabled: false },
  { id: 'horror-movies', title: 'Horror Movies', description: 'Popular horror movies.', group: 'Movie genres', defaultEnabled: false },
  { id: 'romance-movies', title: 'Romance Movies', description: 'Popular romance movies.', group: 'Movie genres', defaultEnabled: false },
  { id: 'sci-fi-movies', title: 'Science Fiction Movies', description: 'Popular science-fiction movies.', group: 'Movie genres', defaultEnabled: false },
  { id: 'thriller-movies', title: 'Thriller Movies', description: 'Popular thriller movies.', group: 'Movie genres', defaultEnabled: false },

  { id: 'on-the-air', title: 'On the Air This Week', description: 'Series with an episode airing in the next seven days.', group: 'TV series', defaultEnabled: false },
  { id: 'airing-today', title: 'Airing Today', description: 'Series with an episode airing today.', group: 'TV series', defaultEnabled: false },
  { id: 'comedy-series', title: 'Comedy Series', description: 'Popular comedy series.', group: 'TV genres', defaultEnabled: false },
  { id: 'crime-series', title: 'Crime Series', description: 'Popular crime series.', group: 'TV genres', defaultEnabled: false },
  { id: 'documentary-series', title: 'Documentary Series', description: 'Popular documentary series.', group: 'TV genres', defaultEnabled: false },
  { id: 'drama-series', title: 'Drama Series', description: 'Popular drama series.', group: 'TV genres', defaultEnabled: false },
  { id: 'family-series', title: 'Family Series', description: 'Popular family series.', group: 'TV genres', defaultEnabled: false },
  { id: 'mystery-series', title: 'Mystery Series', description: 'Popular mystery series.', group: 'TV genres', defaultEnabled: false },
  { id: 'reality-series', title: 'Reality TV', description: 'Popular reality television.', group: 'TV genres', defaultEnabled: false },
  { id: 'sci-fi-fantasy-series', title: 'Sci-Fi & Fantasy Series', description: 'Popular science-fiction and fantasy series.', group: 'TV genres', defaultEnabled: false },

  { id: 'rated-anime-series', title: 'Top Rated Anime Series', description: 'Highly rated Japanese animated series.', group: 'Anime', defaultEnabled: false },
  { id: 'rated-anime-movies', title: 'Top Rated Anime Movies', description: 'Highly rated Japanese animated movies.', group: 'Anime', defaultEnabled: false },
]
