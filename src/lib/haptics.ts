// UI-wide haptics. Thin semantic wrapper over @tauri-apps/plugin-haptics, gated twice: the
// native plugin only exists on mobile (Rust cfg), and every call also short-circuits unless
// the app is on Android AND the `haptics` setting is on. Desktop/web thus never invoke it.
// All plugin calls are fire-and-forget (best-effort; a failing buzz must never break a tap).
// Note: ImpactFeedbackStyle/NotificationFeedbackType are TS-only string-literal types in this
// plugin (no runtime enum object exists), so the literal strings are passed straight through.
import { get } from 'svelte/store'
import { isAndroid } from '$lib/platform'
import { haptics as hapticsEnabled } from '$lib/settings/ui'
import { impactFeedback, notificationFeedback, selectionFeedback } from '@tauri-apps/plugin-haptics'

const enabled = () => get(isAndroid) && get(hapticsEnabled)

/** Light tap — buttons, nav, list rows. */
export const tap = () => { if (enabled()) impactFeedback('light').catch(() => {}) }
/** Selection change — toggles, segmented controls, tab/sort switches. */
export const select = () => { if (enabled()) selectionFeedback().catch(() => {}) }
/** Firmer impact for primary/confirm actions. */
export const impact = (style: 'light' | 'medium' | 'heavy' = 'medium') => {
  if (enabled()) impactFeedback(style).catch(() => {})
}
/** Success / warning / error notification patterns. */
export const success = () => { if (enabled()) notificationFeedback('success').catch(() => {}) }
export const warn = () => { if (enabled()) notificationFeedback('warning').catch(() => {}) }
export const error = () => { if (enabled()) notificationFeedback('error').catch(() => {}) }
