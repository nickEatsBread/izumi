import { trackerHttpFetch } from '$lib/trackers/tracker-http'

/** Stremio's own approval service. Nothing outside this origin may be shown or opened. */
export const STREMIO_LINK_ORIGIN = 'https://link.stremio.com'
const STREMIO_LINK_API = `${STREMIO_LINK_ORIGIN}/api`

export const STREMIO_LINK_POLL_INTERVAL_MS = 3_000
/** 80 x 3s is a little over four minutes, which outlasts a browser sign-in without pinning the
 *  setup screen to a dead code. The service answers a pending and an expired code identically, so
 *  giving up on a count is the only way to stop. */
export const STREMIO_LINK_POLL_ATTEMPTS = 80
/** "Invalid or expired token": returned both while the user has not approved yet and after the
 *  code lapsed. It is the normal answer to every poll before approval. */
export const STREMIO_LINK_PENDING_ERROR = 101
/** How many consecutive transport failures (an offline blip) a poll absorbs before giving up. */
const POLL_FAILURE_LIMIT = 3

export interface StremioLinkCode {
  code: string
  url: string
}

/** 'waiting' once the code is live, 'approved' the moment Stremio hands over a session key. */
export type StremioLinkStatus = 'waiting' | 'approved'

/** Returns the parsed JSON body of a link API GET. Injected in tests so nothing touches the network. */
export type StremioLinkTransport = (url: string, signal?: AbortSignal) => Promise<unknown>

export class StremioLinkError extends Error {
  readonly code?: number

  constructor(message: string, code?: number) {
    super(message)
    this.name = 'StremioLinkError'
    this.code = code
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Sign-in cancelled', 'AbortError')
}

function delay(ms: number, signal?: AbortSignal) {
  aborted(signal)
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Sign-in cancelled', 'AbortError')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export const stremioLinkTransport: StremioLinkTransport = async (url, signal) => {
  const response = await trackerHttpFetch(url, { headers: { Accept: 'application/json' }, signal }, 'Stremio')
  try {
    return await response.json() as unknown
  } catch {
    throw new Error(`Stremio's sign-in service returned an invalid response (${response.status}).`)
  }
}

/** Unwrap the `{ result, error }` envelope both link endpoints answer with, including the pending
 *  poll answer, which arrives as an error rather than an empty result. */
export function unwrapStremioLink(value: unknown): unknown {
  if (typeof value === 'string') return value
  const envelope = record(value)
  const failure = envelope.error
  if (failure != null) {
    const detail = record(failure)
    const code = typeof detail.code === 'number' ? detail.code : undefined
    const message = text(typeof failure === 'string' ? failure : detail.message)
    throw new StremioLinkError(
      message || `Stremio rejected the sign-in code${code == null ? '' : ` (${code})`}.`,
      code,
    )
  }
  // `create` repeats its fields at the top level; `read` only fills `result`.
  return envelope.result == null ? envelope : envelope.result
}

/** Accepts a create response only if the link it asks us to open really is Stremio's. */
export function parseStremioLinkCode(value: unknown): StremioLinkCode {
  const result = record(unwrapStremioLink(value))
  // `create` answers with the same fields inside `result` and at the top level. Prefer the result,
  // but read either, so moving the pair between the two cannot strand sign-in.
  const source = typeof result.code === 'string' ? result : record(value)
  const code = text(source.code)
  if (!code || !/^[\w-]{1,32}$/.test(code)) {
    throw new Error('Stremio did not return a usable sign-in code. Try again.')
  }
  let url: URL
  try {
    url = new URL(text(source.link))
  } catch {
    throw new Error('Stremio did not return a sign-in link. Try again.')
  }
  if (url.origin !== STREMIO_LINK_ORIGIN || url.username || url.password) {
    throw new Error('Stremio returned a sign-in link outside link.stremio.com. It was not opened.')
  }
  return { code, url: url.href }
}

/** Pulls the session key out of an approved read response. The service is documented to answer
 *  `{ result: { authKey } }`; a bare key is accepted too so a shape change cannot strand sign-in. */
export function parseStremioLinkAuthKey(value: unknown): string {
  const result = unwrapStremioLink(value)
  const authKey = typeof result === 'string' ? text(result) : text(record(result).authKey)
  if (!authKey) throw new Error('Stremio approved this device but returned no session key. Try again.')
  return authKey
}

/** Ask Stremio for a fresh link code. The returned URL is the one the user opens to approve. */
export async function createStremioLink(
  signal?: AbortSignal,
  transport: StremioLinkTransport = stremioLinkTransport,
): Promise<StremioLinkCode> {
  aborted(signal)
  return parseStremioLinkCode(await transport(`${STREMIO_LINK_API}/create?type=Create`, signal))
}

/** Poll an outstanding code until Stremio hands over a session key, the caller aborts, or the
 *  bounded window runs out. Only the code travels in the URL — never the key it returns. */
export async function pollStremioLink(
  code: string,
  update: (status: StremioLinkStatus) => void,
  signal?: AbortSignal,
  transport: StremioLinkTransport = stremioLinkTransport,
): Promise<string> {
  const pending = text(code)
  if (!pending) throw new Error('Stremio did not return a usable sign-in code. Try again.')
  const url = `${STREMIO_LINK_API}/read?type=Read&code=${encodeURIComponent(pending)}`
  update('waiting')
  let failures = 0
  for (let attempt = 0; attempt < STREMIO_LINK_POLL_ATTEMPTS; attempt++) {
    await delay(STREMIO_LINK_POLL_INTERVAL_MS, signal)
    let reply: unknown
    try {
      reply = await transport(url, signal)
      failures = 0
    } catch (error) {
      aborted(signal)
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      if (++failures >= POLL_FAILURE_LIMIT) throw error
      continue
    }
    aborted(signal)
    let authKey: string
    try {
      authKey = parseStremioLinkAuthKey(reply)
    } catch (error) {
      // The pending answer and the expired answer are the same error, so waiting is the only
      // reading of it that does not abandon a code the user is still approving.
      if (error instanceof StremioLinkError && error.code === STREMIO_LINK_PENDING_ERROR) continue
      throw error
    }
    update('approved')
    return authKey
  }
  throw new Error('This sign-in code expired before it was approved. Get a new code to try again.')
}
