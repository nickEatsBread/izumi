import { defineEnvVars } from '@sveltejs/kit/env'

// The public build values from .env.local / CI (see .env.example), read through `$app/env/public`.
// All are baked into the bundle at build time: the Tauri client has no server to supply them later.
// Without a schema a variable must be set, though it may be empty; `optional` lets local and
// preview builds leave it out.
const optional = (value: string | undefined) => value

export const variables = defineEnvVars({
  PUBLIC_ANILIST_CLIENT_ID: { public: true, static: true },
  PUBLIC_MAL_CLIENT_ID: { public: true, static: true },
  PUBLIC_OAUTH_REDIRECT_URI: { public: true, static: true },
  PUBLIC_SIMKL_CLIENT_ID: { public: true, static: true, schema: optional },
  PUBLIC_TRAKT_CLIENT_ID: { public: true, static: true, schema: optional },
  PUBLIC_DISCUSS_ANIME_API_KEY: { public: true, static: true, schema: optional },
  PUBLIC_TMDB_READ_TOKEN: { public: true, static: true, schema: optional },
})
