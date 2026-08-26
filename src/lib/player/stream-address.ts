const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/

/** Network-local HTTP servers are used by both Direct P2P and JVM providers. URL shape alone
 * cannot tell those transports apart, but every caller needs one consistent loopback check. */
export function isLoopbackHttpUrl(raw: string | null | undefined): boolean {
  if (!raw) return false
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    return host === 'localhost' || host === '0.0.0.0' || host === '::1' || IPV4_LOOPBACK.test(host)
  } catch {
    return false
  }
}

/** Advertise a wildcard-bound local HTTP service through one reachable host address. */
export function replaceLoopbackHost(raw: string | null | undefined, host: string): string | undefined {
  if (!raw || !isLoopbackHttpUrl(raw)) return raw || undefined
  try {
    const url = new URL(raw)
    url.hostname = host
    return url.toString()
  } catch {
    return undefined
  }
}
