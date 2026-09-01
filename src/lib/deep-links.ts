import { goto } from '$app/navigation'
import { invoke } from '@tauri-apps/api/core'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { writable } from 'svelte/store'
import { resolveDeepLinks } from '$lib/deep-link-target'

/** One-line feedback for the last handled link (rendered as a toast by the app shell). Set for
 *  anything the user would otherwise experience as "nothing happened". */
export const deepLinkNotice = writable('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined

export function showDeepLinkNotice(text: string) {
  deepLinkNotice.set(text)
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => deepLinkNotice.set(''), 4000)
}

async function openUrls(urls: string[] | null) {
  const outcome = resolveDeepLinks(urls)
  if (!outcome) return
  if (outcome.path) await goto(outcome.path)
  if (outcome.notice) showDeepLinkNotice(outcome.notice)
}

export async function initDeepLinks(): Promise<() => void> {
  // `magnet:` is never registered by Izumi. If the user/OS explicitly launches the executable
  // with one anyway, the native argv bridge lets us handle that one request passively.
  const launchUrls = await getCurrent().catch(() => null)
  const magnet = await invoke<string | null>('take_pending_magnet').catch(() => null)
  await openUrls([...(launchUrls ?? []), ...(magnet ? [magnet] : [])])
  return onOpenUrl((urls) => { void openUrls(urls) }).catch(() => () => {})
}
