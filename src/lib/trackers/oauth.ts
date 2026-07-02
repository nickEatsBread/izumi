import { invoke } from '@tauri-apps/api/core'
import { REDIRECT_URI } from './config'

export const redirectUri = REDIRECT_URI

// Opens `authUrl` in an in-app login window (Rust `oauth_capture` command),
// waits until it redirects to REDIRECT_URI, and returns the full captured URL
// (query + fragment) parsed as a URL.
export async function captureLogin(authUrl: string): Promise<URL> {
  const captured = await invoke<string>('oauth_capture', { authUrl, redirectPrefix: REDIRECT_URI })
  return new URL(captured)
}
