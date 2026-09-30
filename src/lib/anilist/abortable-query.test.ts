import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), unsubscribe: vi.fn(), deliver: undefined as undefined | ((value: unknown) => void) }))
vi.mock('./client', () => ({ anilist: { query: mocks.query } }))

import { queryAniList } from './abortable-query'

beforeEach(() => {
  mocks.unsubscribe.mockReset()
  mocks.deliver = undefined
  mocks.query.mockReset().mockImplementation(() => ({
    subscribe: (onResult: (value: unknown) => void) => {
      mocks.deliver = onResult
      return { unsubscribe: mocks.unsubscribe }
    },
  }))
})

describe('queryAniList', () => {
  it('resolves with the network answer and then lets go of the operation', async () => {
    const pending = queryAniList('query Search { Page { media { id } } }', { search: 'x' })
    expect(mocks.query).toHaveBeenCalledWith('query Search { Page { media { id } } }', { search: 'x' }, { requestPolicy: 'network-only' })
    mocks.deliver?.({ data: { ok: true } })
    await expect(pending).resolves.toEqual({ data: { ok: true } })
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('tears the request down when the search is abandoned', async () => {
    const abort = new AbortController()
    const pending = queryAniList('query Search { x }', {}, abort.signal)
    abort.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
    mocks.deliver?.({ data: { late: true } })
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('never starts a request for a search that was already abandoned', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(queryAniList('query Search { x }', {}, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('waits past a stale cached answer for the fresh one, like toPromise()', async () => {
    const pending = queryAniList('query Search { x }', {})
    mocks.deliver?.({ data: { old: true }, stale: true })
    mocks.deliver?.({ data: { partial: true }, hasNext: true })
    mocks.deliver?.({ data: { fresh: true }, stale: false })
    await expect(pending).resolves.toEqual({ data: { fresh: true }, stale: false })
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('copes with an answer delivered while subscribing', async () => {
    mocks.query.mockImplementation(() => ({
      subscribe: (onResult: (value: unknown) => void) => {
        onResult({ data: { cached: true } })
        return { unsubscribe: mocks.unsubscribe }
      },
    }))
    await expect(queryAniList('query Search { x }', {})).resolves.toEqual({ data: { cached: true } })
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
