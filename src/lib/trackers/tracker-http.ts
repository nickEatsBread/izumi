import { invokeNativeHttp } from '$lib/net/http'

interface NativeHttpReply {
  status: number
  headers: Record<string, string>
  body: string
}

export const TRACKER_REQUEST_TIMEOUT_MS = 20_000

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
  throw new TypeError('Tracker requests only support text, JSON strings, or URL-encoded bodies')
}

/** Cross-origin tracker requests through Izumi's pooled native HTTP client. */
export async function trackerHttpFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  service = 'Tracker',
  timeoutMs = TRACKER_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString()
  let reply: NativeHttpReply
  try {
    reply = await invokeNativeHttp<NativeHttpReply>(
      'ext_fetch',
      {
        url,
        method: init.method ?? 'GET',
        headers: headersToObject(init.headers),
        body: textBody(init.body),
      },
      { timeoutMs, signal: init.signal ?? undefined },
    )
  } catch (error) {
    if (String(error).includes('request timed out')) throw new Error(`${service} request timed out`)
    throw error
  }
  const body = [204, 205, 304].includes(reply.status) ? null : reply.body
  return new Response(body, { status: reply.status, headers: reply.headers })
}
