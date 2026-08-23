const SCRIPT_ID = 'discussanime-embed-theme'
const SCRIPT_SRC = 'https://discussanime.moe/embed.js'

let loading: Promise<void> | null = null

export function isDiscussAnimeEmbed(value?: string): boolean {
  if (!value) return false
  try {
    const url = new URL(value, globalThis.location?.origin ?? 'https://izumi.invalid')
    return url.protocol === 'https:'
      && url.hostname === 'discussanime.moe'
      && url.pathname.startsWith('/embed/')
  } catch { return false }
}

/** Load the host-side theme bridge only once an archive iframe is actually needed. */
export function loadDiscussAnimeEmbedTheme(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  if (loading) return loading

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
  if (existing) return Promise.resolve()

  loading = new Promise<void>((resolve) => {
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.type = 'module'
    script.src = SCRIPT_SRC
    script.onload = () => resolve()
    script.onerror = () => {
      script.remove()
      loading = null
      resolve()
    }
    document.head.appendChild(script)
  })
  return loading
}
