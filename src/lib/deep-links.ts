import { goto } from '$app/navigation'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { parseDeepLink } from '$lib/deep-link-target'

async function openUrls(urls: string[] | null) {
  for (const raw of urls ?? []) {
    const target = parseDeepLink(raw)
    if (target) { await goto(target.path); break }
  }
}

export async function initDeepLinks(): Promise<() => void> {
  await openUrls(await getCurrent().catch(() => null))
  return onOpenUrl((urls) => { void openUrls(urls) }).catch(() => () => {})
}
