import { start, onUrl, cancel } from '@fabianlars/tauri-plugin-oauth'
import { openUrl } from '@tauri-apps/plugin-opener'
import { REDIRECT_PORT } from './config'

export const redirectUri = `http://localhost:${REDIRECT_PORT}/callback`

// Opens `buildUrl(state)` in the browser, resolves with the captured callback URL.
export async function loopbackLogin(buildUrl: (state: string) => string): Promise<URL> {
  const port = await start({ ports: [REDIRECT_PORT], response: 'Login complete — you can close this tab and return to the app.' })
  if (port !== REDIRECT_PORT) { await cancel(port); throw new Error(`Port ${REDIRECT_PORT} is busy; close what's using it and retry.`) }
  const state = crypto.randomUUID()
  return await new Promise<URL>((resolve, reject) => {
    const to = setTimeout(async () => { await done(); reject(new Error('Login timed out.')) }, 120_000)
    let un: (() => void) | undefined
    const done = async () => { clearTimeout(to); un?.(); await cancel(port).catch(() => {}) }
    onUrl(async (url) => {
      const u = new URL(url)
      if (u.searchParams.get('state') !== state) return
      await done(); resolve(u)
    }).then((fn) => (un = fn))
    openUrl(buildUrl(state)).catch(async (e) => { await done(); reject(e) })
  })
}
