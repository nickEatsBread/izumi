// UI-wide haptics. Thin semantic wrapper over @tauri-apps/plugin-haptics, gated twice: the
// native plugin only exists on mobile (Rust cfg), and every call also short-circuits unless
// the app is on Android AND the `haptics` setting is on. Desktop/web thus never invoke it.
// All plugin calls are fire-and-forget (best-effort; a failing buzz must never break a tap).
import { get } from 'svelte/store'
import { isAndroid } from '$lib/platform'
import { haptics as hapticsEnabled } from '$lib/settings/ui'
import {
  impactFeedback, ImpactFeedbackStyle,
  notificationFeedback, NotificationFeedbackType,
  selectionFeedback,
} from '@tauri-apps/plugin-haptics'

const enabled = () => get(isAndroid) && get(hapticsEnabled)

/** Light tap — buttons, nav, list rows. */
export const tap = () => { if (enabled()) impactFeedback(ImpactFeedbackStyle.Light).catch(() => {}) }
/** Selection change — toggles, segmented controls, tab/sort switches. */
export const select = () => { if (enabled()) selectionFeedback().catch(() => {}) }
/** Firmer impact for primary/confirm actions. */
export const impact = (style: 'light' | 'medium' | 'heavy' = 'medium') => {
  if (!enabled()) return
  const s = style === 'light' ? ImpactFeedbackStyle.Light
    : style === 'heavy' ? ImpactFeedbackStyle.Heavy : ImpactFeedbackStyle.Medium
  impactFeedback(s).catch(() => {})
}
/** Success / warning / error notification patterns. */
export const success = () => { if (enabled()) notificationFeedback(NotificationFeedbackType.Success).catch(() => {}) }
export const warn = () => { if (enabled()) notificationFeedback(NotificationFeedbackType.Warning).catch(() => {}) }
export const error = () => { if (enabled()) notificationFeedback(NotificationFeedbackType.Error).catch(() => {}) }
