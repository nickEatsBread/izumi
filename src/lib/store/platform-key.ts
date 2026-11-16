import { arch, platform } from '@tauri-apps/plugin-os'

let cached: string | null = null

/** `<os>-<arch>` as native packages name their builds (`linux-x86_64`, `windows-aarch64`…), the same
 *  key the Rust package installer checks. `unknown` outside Tauri. */
export function storePlatformKey(): string {
  if (cached) return cached
  try {
    cached = `${platform()}-${arch()}`
  } catch {
    cached = 'unknown'
  }
  return cached
}
