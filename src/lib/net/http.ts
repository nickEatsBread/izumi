import { invoke } from '@tauri-apps/api/core'

// Pooled GET through the Rust shared reqwest client. Use this instead of
// `@tauri-apps/plugin-http`'s `fetch` on the hot resolve path (addon streams,
// manifests, AniZip, the id map): the plugin builds a NEW reqwest client per
// request, so it never reuses a connection and pays the full ~300ms TCP+TLS
// handshake every time. The shared client keeps the pool warm → ~25ms on repeat
// fetches to the same host. Follows redirects; returns a minimal Response-like.
export interface PooledResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}

export async function phttp(url: string, init?: { headers?: Record<string, string> }): Promise<PooledResponse> {
  const r = await invoke<{ status: number; body: string }>('http_get', { url, headers: init?.headers })
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => JSON.parse(r.body),
    text: async () => r.body,
  }
}
