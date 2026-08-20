import { invoke } from '@tauri-apps/api/core'
import { currentResolveTrace, safeRequestTarget, traceResolve, traceResolveError } from '$lib/debug/resolve-trace'
import { developerConsoleEnabled } from '$lib/debug/log-gate'

export interface NativeHttpOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
  requestId?: string
  /** Click-to-play critical path: rides the reserved Rust playback lane. */
  priority?: boolean
  /** Bulk traffic (a multi-megabyte index, a warm-up prefetch): rides the Rust BACKGROUND lane,
   *  which can never take a permit from the metadata lane the UI's own queries ride. Rust has had
   *  this lane since the lifecycle rework, but nothing could ask for it — every frontend request
   *  landed in the metadata lane, so a single large download competed with the covers and queries
   *  the user is waiting on. Worst on a first-ever launch, where nothing is cached and the biggest
   *  download of the app's life happens while the home page is still filling in. */
  background?: boolean
}

export interface NativeHttpTimings {
  queueMs: number
  responseMs: number
  bodyMs: number
  nativeTotalMs: number
}

let requestSequence = 0
let debugRequestSequence = 0

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
  const trace = currentResolveTrace()
  const debugId = trace ? ++debugRequestSequence : 0
  const debugStartedAt = globalThis.performance?.now?.() ?? Date.now()
  if (trace) traceResolve(trace, `HTTP ${debugId} start`, {
    command,
    target: safeRequestTarget(args.url),
    timeoutMs: options.timeoutMs,
    lane: options.priority ? 'playback' : options.background ? 'background' : 'metadata',
  })
  const requestArgs: Record<string, unknown> = { ...args, requestId }
  if (options.timeoutMs != null) requestArgs.timeoutMs = options.timeoutMs
  if (options.maxBytes != null) requestArgs.maxBytes = options.maxBytes
  if (options.priority) requestArgs.priority = true
  if (options.background) requestArgs.background = true

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
    const result = await Promise.race(pending)
    const ipcMs = Math.round((globalThis.performance?.now?.() ?? Date.now()) - debugStartedAt)
    const timings = typeof result === 'object' && result && 'timings' in result
      ? (result as { timings?: NativeHttpTimings }).timings
      : undefined
    const details = {
      command,
      target: safeRequestTarget(args.url),
      durationMs: ipcMs,
      ...timings,
      status: typeof result === 'object' && result && 'status' in result
        ? (result as { status?: unknown }).status
        : undefined,
      lane: options.priority ? 'playback' : options.background ? 'background' : 'metadata',
    }
    if (developerConsoleEnabled()) console.debug('[izumi net]', details)
    if (trace) traceResolve(trace, `HTTP ${debugId} finish`, details)
    return result
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[izumi net] failed', {
      command,
      target: safeRequestTarget(args.url),
      durationMs: Math.round((globalThis.performance?.now?.() ?? Date.now()) - debugStartedAt),
      lane: options.priority ? 'playback' : options.background ? 'background' : 'metadata',
      error: error instanceof Error ? error.message : String(error),
    })
    if (trace) traceResolveError(trace, `HTTP ${debugId} failed`, error, {
      command,
      target: safeRequestTarget(args.url),
      durationMs: Math.round((globalThis.performance?.now?.() ?? Date.now()) - debugStartedAt),
    })
    throw error
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
