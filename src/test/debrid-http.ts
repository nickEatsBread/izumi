import type { Mock } from 'vitest'

// Test-only helper for the debrid providers. Every provider speaks HTTP through `jfetch`, which
// calls `invokeNativeHttp` from $lib/net/http — mock that single module and a provider becomes
// testable end to end, including WHICH endpoints it did and (the point of the noAdd contract) did
// not call. Not imported by any shipped code.

export type Route = [pattern: string | RegExp, json: unknown]

/** Point a mocked `invokeNativeHttp` at a small routing table: the first pattern matching the URL
 *  wins and its JSON is served with a 200. Anything unmatched answers 404 with an empty body, so a
 *  provider firing an unexpected request fails on its own error path instead of quietly
 *  succeeding — and the call is still recorded for assertions. */
export function serveJson(fetchMock: Mock, routes: Route[]): void {
  fetchMock.mockImplementation(async (_command: string, args: { url: string }) => {
    const url = String(args?.url)
    const hit = routes.find(([p]) => (typeof p === 'string' ? url.includes(p) : p.test(url)))
    return { status: hit ? 200 : 404, body: JSON.stringify(hit ? hit[1] : {}) }
  })
}

/** Every URL the provider requested, in order. invokeNativeHttp receives (command, args), so the
 *  URL lives on the second argument. */
export const urlsOf = (fetchMock: Mock): string[] =>
  fetchMock.mock.calls.map((c) => String((c[1] as { url?: string } | undefined)?.url ?? c[0]))

/** Did the provider hit `pattern` at all? The assertion the noAdd contract turns on. */
export const called = (fetchMock: Mock, pattern: string): boolean =>
  urlsOf(fetchMock).some((u) => u.includes(pattern))
