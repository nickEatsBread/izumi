import { invoke } from '@tauri-apps/api/core'

interface NativeHttpReply {
  status: number
  headers: Record<string, string>
  body: string
}

export const MAL_REQUEST_TIMEOUT_MS = 20_000

function headersToObject(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result
  if (headers instanceof Headers) headers.forEach((value, key) => { result[key] = value })
  else if (Array.isArray(headers)) for (const [key, value] of headers) result[key] = value
  else Object.assign(result, headers)
  return result
}

function textBody(body?: BodyInit | null): string | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  throw new TypeError('MAL requests only support text or URL-encoded bodies')
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('MyAnimeList request timed out')), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// MAL requests use the same pooled native reqwest client as AniList. Unlike
// tauri-plugin-http, this command fully reads the response in Rust before handing
// plain data to the webview, so concurrent home-screen requests cannot strand a
// lazily streamed response resource.
export async function malHttpFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = MAL_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString()
  const request = invoke<NativeHttpReply>('ext_fetch', {
    url,
    method: init.method ?? 'GET',
    headers: headersToObject(init.headers),
    body: textBody(init.body),
  })
  const reply = await withTimeout(request, timeoutMs)
  const body = [204, 205, 304].includes(reply.status) ? null : reply.body
  return new Response(body, { status: reply.status, headers: reply.headers })
}
