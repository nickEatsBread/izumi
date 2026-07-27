import type { Mock } from 'vitest'

// Test-only helper for the debrid providers. Every provider speaks HTTP through `jfetch`, which
// calls @tauri-apps/plugin-http's `fetch` — mock that single module and a provider becomes
// testable end to end, including WHICH endpoints it did and (the point of the noAdd contract) did
// not call. Not imported by any shipped code.

export type Route = [pattern: string | RegExp, json: unknown]

/** Point a mocked plugin-http `fetch` at a small routing table: the first pattern matching the URL
 *  wins and its JSON is served with a 200. Anything unmatched answers 404 with an empty body, so a
 *  provider firing an unexpected request fails on its own error path instead of quietly
 *  succeeding — and the call is still recorded for assertions. */
export function serveJson(fetchMock: Mock, routes: Route[]): void {
  fetchMock.mockImplementation(async (url: string) => {
    const hit = routes.find(([p]) => (typeof p === 'string' ? String(url).includes(p) : p.test(String(url))))
    return { ok: !!hit, status: hit ? 200 : 404, text: async () => JSON.stringify(hit ? hit[1] : {}) }
  })
}

/** Every URL the provider requested, in order. */
export const urlsOf = (fetchMock: Mock): string[] => fetchMock.mock.calls.map((c) => String(c[0]))

/** Did the provider hit `pattern` at all? The assertion the noAdd contract turns on. */
export const called = (fetchMock: Mock, pattern: string): boolean =>
  urlsOf(fetchMock).some((u) => u.includes(pattern))
