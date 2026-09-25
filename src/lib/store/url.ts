/** Hosts a store may never live on: loopback, private, carrier-grade NAT and link-local ranges, the
 *  "this network" block, mDNS and private-use names, IPv6 literals. A store link can arrive from a web
 *  page (izumi://store/add), so previewing one must not become a way to probe the user's own network.
 *  Single-label names are refused separately. */
const PRIVATE_HOST = /^(?:localhost|.+\.(?:localhost|local|internal|lan|intranet|home\.arpa)|0\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|\[.*\])$/i

/** The one form a store URL is stored and compared in: public HTTPS, no credentials, no fragment, no
 *  trailing dot on the host, dot segments resolved. Null for anything else. */
export function canonicalStoreUrl(candidate: string): string | null {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  // "host." names the same host as "host"; drop the dot so it can't slip past the checks below.
  const host = url.hostname.replace(/\.+$/, '')
  // Single-label names ("router", "nas") only resolve on the local network.
  if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') || PRIVATE_HOST.test(host)) return null
  url.hostname = host
  url.hash = ''
  return url.href
}

function githubRaw(owner: string, repo: string, ref: string, path: string): string | null {
  const folder = path.replace(/\/+$/, '')
  const file = /\.json$/i.test(folder) ? folder : [folder, 'index.json'].filter(Boolean).join('/')
  const url = canonicalStoreUrl(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file}`)
  // Dot segments must not climb out of the repository the link names.
  return url && url.startsWith(`https://raw.githubusercontent.com/${owner}/${repo}/`) ? url : null
}

/**
 * Turn a pasted store address, or one carried by a deep link, into the URL its index is fetched
 * from. Accepts public HTTPS links (GitHub repository, folder and file pages become raw links) and
 * GitHub shorthand `owner/repo[@ref][/path]` or `gh:owner/repo…`, which defaults to `index.json` at
 * the repository root. Returns null for anything else — stores are never fetched over plain HTTP.
 */
export function resolveStoreUrl(input: string): string | null {
  const value = input.trim().replace(/^(['"])(.*)\1$/, '$2').trim()
  if (!value || value.length > 2048) return null
  if (!/^https?:\/\//i.test(value)) {
    const shorthand = value.startsWith('gh:') ? value.slice(3) : value
    const match = shorthand.match(/^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+?)(?:@([A-Za-z0-9._-]+))?(?:\/([^\s?#]*))?$/)
    if (!match) return null
    const [, owner, repo, ref = 'HEAD', path = ''] = match
    return githubRaw(owner, repo, ref, path)
  }
  const url = canonicalStoreUrl(value)
  if (!url) return null
  const parsed = new URL(url)
  if (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') {
    const [owner, repo, kind, ref, ...rest] = parsed.pathname.split('/').filter(Boolean)
    if (owner && repo && !kind) return githubRaw(owner, repo, 'HEAD', '')
    if (owner && repo && (kind === 'blob' || kind === 'tree') && ref) return githubRaw(owner, repo, ref, rest.join('/'))
  }
  return url
}

/** Where a store's detached signature lives: the index path plus `.sig`. */
export function signatureUrl(indexUrl: string): string {
  const url = new URL(indexUrl)
  url.pathname += '.sig'
  return url.href
}
