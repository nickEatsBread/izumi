/** Validate and normalize the SOCKS5 endpoint before it reaches the native torrent engine.
 * Throwing is deliberate: an enabled-but-invalid privacy setting must never silently fall back to
 * the normal connection. */
export function torrentProxyEndpoint(enabled: boolean, value: string): string | null {
  if (!enabled) return null
  const input = value.trim()
  if (!input) throw new Error('Enter a SOCKS5 proxy URL for Direct P2P.')
  let parsed: URL
  try { parsed = new URL(input) }
  catch { throw new Error('The Direct P2P proxy URL is invalid.') }
  if (parsed.protocol !== 'socks5:') throw new Error('Direct P2P currently supports SOCKS5 proxies only.')
  if (!parsed.hostname || !parsed.port) throw new Error('The SOCKS5 proxy URL needs a host and port.')
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error('The SOCKS5 proxy URL cannot contain a path, query, or fragment.')
  }
  return parsed.toString().replace(/\/$/, '')
}
