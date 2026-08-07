import { invoke } from '@tauri-apps/api/core'

export interface NativeHttpOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
  requestId?: string
  /** Click-to-play critical path: rides the reserved Rust playback lane. */
  priority?: boolean
}

let requestSequence = 0

function nextRequestId(command: string) {
  const random = globalThis.crypto?.randomUUID?.()
  return random ? `${command}:${random}` : `${command}:${Date.now()}:${++requestSequence}`
}

function abortError() {
  return new DOMException('The request was aborted', 'AbortError')
}

/** Invoke one bounded Rust HTTP command and propagate AbortSignal cancellation across IPC. */
export async function invokeNativeHttp<T>(
  command: 'http_get' | 'http_post' | 'ext_fetch',
  args: Record<string, unknown>,
  options: NativeHttpOptions = {},
): Promise<T> {
  if (options.signal?.aborted) throw abortError()
  const requestId = options.requestId ?? nextRequestId(command)
  const requestArgs: Record<string, unknown> = { ...args, requestId }
  if (options.timeoutMs != null) requestArgs.timeoutMs = options.timeoutMs
  if (options.maxBytes != null) requestArgs.maxBytes = options.maxBytes
  if (options.priority) requestArgs.priority = true

  let rejectAbort: ((reason: Error) => void) | undefined
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    if (options.timeoutMs == null) return
    timeoutHandle = setTimeout(() => {
      void invoke('http_cancel', { requestId }).catch(() => {})
      reject(new Error('request timed out'))
    }, options.timeoutMs)
  })
  const onAbort = () => {
    // Reject the UI operation immediately and signal Rust to drop the queued/in-flight reqwest
    // future. The cancellation command is intentionally fire-and-forget.
    void invoke('http_cancel', { requestId }).catch(() => {})
    rejectAbort?.(abortError())
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const request = invoke<T>(command, requestArgs)
    const pending: Promise<T>[] = [request]
    if (options.signal) pending.push(aborted)
    if (options.timeoutMs != null) pending.push(timedOut)
    return await Promise.race(pending)
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

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

export async function phttp(
  url: string,
  init?: { headers?: Record<string, string> } & NativeHttpOptions,
): Promise<PooledResponse> {
  const r = await invokeNativeHttp<{ status: number; body: string }>(
    'http_get',
    { url, headers: init?.headers },
    init,
  )
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => JSON.parse(r.body),
    text: async () => r.body,
  }
}
