import { describe, it, expect, beforeEach, vi } from 'vitest'
import { get } from 'svelte/store'

// Mock the native plugin; every fn returns a resolved promise (the wrapper .catch()es it).
const ok = () => Promise.resolve()
const impactFeedback = vi.fn(ok)
const notificationFeedback = vi.fn(ok)
const selectionFeedback = vi.fn(ok)
vi.mock('@tauri-apps/plugin-haptics', () => ({
  impactFeedback: (s: string) => impactFeedback(s),
  notificationFeedback: (t: string) => notificationFeedback(t),
  selectionFeedback: () => selectionFeedback(),
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' },
  NotificationFeedbackType: { Success: 'Success', Warning: 'Warning', Error: 'Error' },
}))

import { isAndroid } from '$lib/platform'
import { haptics as hapticsEnabled } from '$lib/settings/ui'
import { tap, select, impact, success, error } from '$lib/haptics'

describe('haptics gating', () => {
  beforeEach(() => {
    impactFeedback.mockClear(); notificationFeedback.mockClear(); selectionFeedback.mockClear()
    hapticsEnabled.set(true)
  })

  it('no-ops when not on Android even if enabled', () => {
    isAndroid.set(false); hapticsEnabled.set(true)
    tap(); select(); impact(); success(); error()
    expect(impactFeedback).not.toHaveBeenCalled()
    expect(selectionFeedback).not.toHaveBeenCalled()
    expect(notificationFeedback).not.toHaveBeenCalled()
  })

  it('no-ops on Android when the setting is off', () => {
    isAndroid.set(true); hapticsEnabled.set(false)
    tap(); select(); impact(); success()
    expect(impactFeedback).not.toHaveBeenCalled()
    expect(selectionFeedback).not.toHaveBeenCalled()
    expect(notificationFeedback).not.toHaveBeenCalled()
  })

  it('fires the right feedback on Android when enabled', () => {
    isAndroid.set(true); hapticsEnabled.set(true)
    tap();     expect(impactFeedback).toHaveBeenLastCalledWith('Light')
    impact('heavy'); expect(impactFeedback).toHaveBeenLastCalledWith('Heavy')
    select();  expect(selectionFeedback).toHaveBeenCalledTimes(1)
    success(); expect(notificationFeedback).toHaveBeenLastCalledWith('Success')
    error();   expect(notificationFeedback).toHaveBeenLastCalledWith('Error')
    expect(get(hapticsEnabled)).toBe(true)
  })
})
