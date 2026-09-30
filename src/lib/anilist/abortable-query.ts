import type { AnyVariables, DocumentInput, OperationResult } from '@urql/core'
import { anilist } from './client'

const cancelled = () => new DOMException('Search cancelled', 'AbortError')

/** An AniList read that can be abandoned. `toPromise()` cannot be cancelled; dropping the
 *  subscription tears the operation down instead, so a search the viewer has already typed past
 *  stops waiting in the rate limiter's queue and, if it had not started, costs no request. */
export function queryAniList<Data = unknown, Variables extends AnyVariables = AnyVariables>(
  query: DocumentInput<Data, Variables>,
  variables: Variables,
  signal?: AbortSignal,
): Promise<OperationResult<Data, Variables>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled())
      return
    }
    let done = false
    let subscription: { unsubscribe(): void } | undefined
    const settle = () => {
      done = true
      signal?.removeEventListener('abort', onAbort)
      subscription?.unsubscribe()
    }
    const onAbort = () => {
      if (done) return
      settle()
      reject(cancelled())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    subscription = anilist.query<Data, Variables>(query, variables, { requestPolicy: 'network-only' }).subscribe((result) => {
      // Like toPromise(): a stale cached answer or an incremental part is followed by the real one.
      if (done || result.stale || result.hasNext) return
      settle()
      resolve(result)
    })
    // An answer delivered during subscribe() settled before `subscription` existed.
    if (done) subscription.unsubscribe()
  })
}
