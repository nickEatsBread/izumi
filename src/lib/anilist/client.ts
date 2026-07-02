import { Client, fetchExchange } from '@urql/core'
import { authExchange } from '@urql/exchange-auth'
import { cacheExchange } from '@urql/exchange-graphcache'
import Bottleneck from 'bottleneck'
import { getToken } from './auth'

const limiter = new Bottleneck({
  reservoir: 90,
  reservoirRefreshAmount: 90,
  reservoirRefreshInterval: 60_000,
  maxConcurrent: 3,
  minTime: 200,
})

const limitedFetch: typeof fetch = (input, init) =>
  limiter.schedule(() => fetch(input as RequestInfo, init)) as Promise<Response>

export const anilist = new Client({
  url: 'https://graphql.anilist.co',
  // AniList's GraphQL endpoint only accepts POST. urql v6 defaults
  // preferGetMethod to 'within-url-limit' (GET for short queries) -> 404.
  preferGetMethod: false,
  exchanges: [
    cacheExchange({}),
    authExchange(async (utils) => ({
      addAuthToOperation(op) {
        const t = getToken()
        return t ? utils.appendHeaders(op, { Authorization: `Bearer ${t}` }) : op
      },
      didAuthError: () => false,
      refreshAuth: async () => {},
    })),
    fetchExchange,
  ],
  fetch: limitedFetch,
})
