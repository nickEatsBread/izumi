/**
 * Turn a pasted store address, or one carried by a deep link, into the URL its index is fetched
 * from. Accepts public HTTPS links (GitHub `blob` pages become raw file links) and GitHub shorthand
 * `owner/repo[@ref][/path]` or `gh:owner/repo…`, which defaults to `index.json` at the repository
 * root. Returns null for anything else — stores are never fetched over plain HTTP.
 */
export function resolveStoreUrl(input: string): string | null {
  const value = input.trim().replace(/^(['"])(.*)\1$/, '$2').trim()
  if (!value || value.length > 2048) return null
  if (!/^https?:\/\//i.test(value)) {
    const shorthand = value.startsWith('gh:') ? value.slice(3) : value
    const match = shorthand.match(/^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+?)(?:@([A-Za-z0-9._-]+))?(?:\/([^\s?#]*))?$/)
    if (!match) return null
    const [, owner, repo, ref = 'HEAD', path = ''] = match
    const folder = path.replace(/\/+$/, '')
    const file = /\.json$/i.test(folder) ? folder : [folder, 'index.json'].filter(Boolean).join('/')
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file}`
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  url.hash = ''
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.hostname === 'github.com' && parts[2] === 'blob' && parts.length >= 5) {
    return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join('/')}`
  }
  return url.href
}

/** Where a store's detached signature lives: the index path plus `.sig`. */
export function signatureUrl(indexUrl: string): string {
  const url = new URL(indexUrl)
  url.pathname += '.sig'
  return url.href
}
