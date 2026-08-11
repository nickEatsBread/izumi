/** Dev-only timing trace for the click-to-player path.
 *
 * Keep this module dependency-free: the native HTTP wrapper imports it so requests made by AniZip,
 * add-ons, extensions and debrid providers can all join the same trace without creating cycles.
 */

export type ResolveTrace = {
  id: string
  mediaId: number
  episode?: number
  startedAt: number
  lastAt: number
  closed: boolean
}

type TraceDetails = Record<string, unknown>

let sequence = 0
let active: ResolveTrace | undefined

const enabled = import.meta.env.DEV
const now = () => globalThis.performance?.now?.() ?? Date.now()

function redactString(value: string): string {
  return value
    .replace(/magnet:\?[^\s"']+/gi, '[magnet redacted]')
    .replace(/https?:\/\/[^\s"']+/gi, '[url redacted]')
    .replace(/\b[a-f0-9]{40}\b/gi, '[hash redacted]')
    .replace(/\b(?:bearer|apikey|api_key|token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
}

function safeValue(value: unknown, key = '', depth = 0): unknown {
  if (depth > 4) return '[omitted]'
  if (/key|token|authorization|cookie|header|magnet|hash|url/i.test(key)) return '[redacted]'
  if (typeof value === 'string') return redactString(value)
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) }
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeValue(item, '', depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 50)
      .map(([childKey, child]) => [childKey, safeValue(child, childKey, depth + 1)]))
  }
  return String(value)
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(safeValue(value)) }
  catch { return '"[unserializable]"' }
}

function prefix(trace: ResolveTrace, at: number): string {
  const elapsed = Math.round(at - trace.startedAt)
  const delta = Math.round(at - trace.lastAt)
  return `[resolve ${trace.id} +${elapsed}ms Δ${delta}ms]`
}

export function beginResolveTrace(input: {
  mediaId: number
  episode?: number
  title: string
  entry: string
}): ResolveTrace | undefined {
  if (!enabled) return undefined
  if (active && !active.closed) finishResolveTrace(active, 'superseded')
  const startedAt = now()
  const trace: ResolveTrace = {
    id: `${input.mediaId}:${input.episode ?? 'movie'}#${++sequence}`,
    mediaId: input.mediaId,
    episode: input.episode,
    startedAt,
    lastAt: startedAt,
    closed: false,
  }
  active = trace
  console.info(`${prefix(trace, startedAt)} START ${input.entry} ${safeJson({
    title: input.title,
    mediaId: input.mediaId,
    episode: input.episode,
  })}`)
  return trace
}

export function currentResolveTrace(mediaId?: number, episode?: number): ResolveTrace | undefined {
  if (!enabled || !active || active.closed) return undefined
  if (mediaId != null && active.mediaId !== mediaId) return undefined
  if (episode !== undefined && active.episode !== episode) return undefined
  return active
}

export function traceResolve(
  trace: ResolveTrace | undefined,
  event: string,
  details: TraceDetails = {},
): void {
  if (!enabled || !trace || trace.closed) return
  const at = now()
  console.info(`${prefix(trace, at)} ${event} ${safeJson(details)}`)
  trace.lastAt = at
}

export function traceResolveError(
  trace: ResolveTrace | undefined,
  event: string,
  error: unknown,
  details: TraceDetails = {},
): void {
  if (!enabled || !trace || trace.closed) return
  const at = now()
  console.error(`${prefix(trace, at)} ${event} ${safeJson({ ...details, error })}`)
  trace.lastAt = at
}

export function finishResolveTrace(
  trace: ResolveTrace | undefined,
  outcome: string,
  details: TraceDetails = {},
): void {
  if (!enabled || !trace || trace.closed) return
  const at = now()
  console.info(`${prefix(trace, at)} END ${outcome} ${safeJson({
    totalMs: Math.round(at - trace.startedAt),
    ...details,
  })}`)
  trace.lastAt = at
  trace.closed = true
  if (active === trace) active = undefined
}

/** Host plus a deliberately shallow route label. Query values and deeper path segments may carry
 * add-on/debrid credentials, so they never reach the console. */
export function safeRequestTarget(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'native-command'
  try {
    const parsed = new URL(value)
    const first = parsed.pathname.split('/').filter(Boolean)[0]
    const route = first && /^[a-z0-9._-]{1,32}$/i.test(first) ? `/${first}` : ''
    return `${parsed.hostname}${route}`
  } catch {
    return 'native-command'
  }
}
