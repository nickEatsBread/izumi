/** Which addresses a plugin may fetch. Only HTTPS, only the domains its manifest lists or the host of
 *  the endpoint the viewer typed into its `url` setting. Local and private addresses are refused unless
 *  they are that endpoint (a model running on this computer), which may then use plain HTTP.
 *  shortcut: checks the URL's literal host, not its DNS answer, so a public name that resolves to a
 *  private address is not caught; upgrade to a resolving check in Rust (spec §7.4 plugin_fetch). */

const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./]

export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (PRIVATE_V4.some((pattern) => pattern.test(host))) return true
  // IPv6 loopback, unspecified, unique-local (fc00::/7) and link-local (fe80::/10).
  return host === '::1' || host === '::' || /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89ab][0-9a-f]?:/.test(host)
}

function domainMatches(hostname: string, domain: string): boolean {
  if (domain.startsWith('*.')) return hostname.endsWith(domain.slice(1)) && hostname.length > domain.length - 1
  return hostname === domain
}

/** The parsed URL when the plugin may fetch it, otherwise an Error naming the reason. */
export function checkPluginUrl(raw: string, domains: readonly string[], endpoint?: string): URL | Error {
  let url: URL
  try { url = new URL(raw) } catch { return new Error('blocked: not a URL') }
  if (url.username || url.password) return new Error('blocked: URL carries credentials')
  let endpointHost: string | undefined
  try { endpointHost = endpoint ? new URL(endpoint).host.toLowerCase() : undefined } catch { endpointHost = undefined }
  const isEndpoint = !!endpointHost && url.host.toLowerCase() === endpointHost
  const hostname = url.hostname.toLowerCase()
  if (isEndpoint) {
    if (url.protocol === 'https:') return url
    return url.protocol === 'http:' && isLocalHost(hostname) ? url : new Error('blocked: use https for this address')
  }
  if (url.protocol !== 'https:') return new Error('blocked: only https is allowed')
  if (isLocalHost(hostname)) return new Error('blocked: local or private address')
  return domains.some((domain) => domainMatches(hostname, domain)) ? url : new Error('blocked: host not allowed')
}
