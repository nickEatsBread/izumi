import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { openUrl } from '@tauri-apps/plugin-opener'
import { REDIRECT_URI } from './config'

export const redirectUri = REDIRECT_URI

// Opens buildUrl(state) in the system browser; resolves with the captured
// `animeclient://callback?...` deep-link URL whose state matches.
export async function deepLinkLogin(buildUrl: (state: string) => string): Promise<URL> {
  const state = crypto.randomUUID()
  return await new Promise<URL>((resolve, reject) => {
    let un: (() => void) | undefined
    const to = setTimeout(() => { un?.(); reject(new Error('Login timed out.')) }, 300_000)
    onOpenUrl((urls) => {
      for (const raw of urls) {
        let u: URL
        try { u = new URL(raw) } catch { continue }
        if (u.searchParams.get('state') !== state) continue
        clearTimeout(to); un?.(); resolve(u); return
      }
    }).then((fn) => { un = fn })
    openUrl(buildUrl(state)).catch((e) => { clearTimeout(to); un?.(); reject(e) })
  })
}
