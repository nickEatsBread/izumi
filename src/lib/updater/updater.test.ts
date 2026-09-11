import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Tauri + Android layers so the facade logic is tested in isolation.
const h = vi.hoisted(() => ({
  isAndroid: false, isPackaged: true, flatpak: false, gameMode: false,
  flatpakChannel: 'stable',
  playing: false, androidMpvActive: false,
  // Subscriber sets let a test drive store transitions (true→false = playback exit) after the
  // scheduler has subscribed; the fire-once stubs above can't express a change over time.
  playingSubs: new Set<(v: boolean) => void>(),
  mpvSubs: new Set<(v: boolean) => void>(),
  // Registered Tauri event handlers, so a test can fire a progress payload at the facade.
  handlers: new Map<string, (e: unknown) => void>(),
}))
vi.mock('$lib/platform', () => ({ isAndroid: { subscribe: (f: any) => (f(h.isAndroid), () => {}) } }))
// `gameMode` drives the Game-mode branch; `playing` is the playback-exit trigger for the
// re-surface scheduler. The `playing` stub registers subscribers so tests can push transitions.
vi.mock('$lib/player/session', () => ({
  gameMode: { subscribe: (f: any) => (f(h.gameMode), () => {}) },
  playing: {
    subscribe: (f: any) => { h.playingSubs.add(f); f(h.playing); return () => { h.playingSubs.delete(f) } },
  },
}))
// The scheduler also re-surfaces when the embedded Android player closes.
vi.mock('$lib/player/android-mpv', () => ({
  androidMpvActive: {
    subscribe: (f: any) => { h.mpvSubs.add(f); f(h.androidMpvActive); return () => { h.mpvSubs.delete(f) } },
  },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (cmd: string) => {
  if (cmd === 'is_flatpak') return h.flatpak
  if (cmd === 'flatpak_current_channel') return h.flatpakChannel
  if (cmd === 'updater_check') return { version: '0.2.0', current: '0.1.3', notes: 'x', date: null }
  return null
}) }))
// The opener plugin isn't part of the facade logic under test; stub it so the flatpak branch's
// release-page redirect doesn't reach the real (browser-only) implementation in the node env.
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => {}) }))
// Download progress arrives on Tauri events (listenSafe). Record the handlers so tests can emit.
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (e: unknown) => void) => {
    h.handlers.set(name, cb)
    return () => h.handlers.delete(name)
  }),
}))

import { pickTarget, type UpdateTarget } from './index'

// Reset shared mock state before EVERY test in the file — the later top-level it() blocks live
// outside the describe, so a describe-scoped beforeEach wouldn't isolate them (order-independence).
beforeEach(() => {
  h.isAndroid = false; h.flatpak = false; h.gameMode = false; h.flatpakChannel = 'stable'; h.handlers.clear()
  h.playing = false; h.androidMpvActive = false
  // Drop any subscriber a scheduler left behind so a leaked startUpdateChecks can't react here.
  h.playingSubs.clear(); h.mpvSubs.clear()
})

describe('updater facade', () => {
  it('routes desktop to the tauri updater', async () => {
    expect(await pickTarget()).toBe<UpdateTarget>('desktop')
  })
  it('routes android to the apk updater', async () => {
    h.isAndroid = true
    expect(await pickTarget()).toBe<UpdateTarget>('android')
  })
  it('routes a flatpak install to the portal target', async () => {
    h.flatpak = true
    expect(await pickTarget()).toBe<UpdateTarget>('flatpak')
  })
})

import { checkForUpdate, availableUpdate, updatePhase } from './index'
import { get } from 'svelte/store'

it('checkForUpdate populates the store + phase on desktop', async () => {
  await checkForUpdate()
  expect(get(availableUpdate)?.version).toBe('0.2.0')
  expect(get(updatePhase)).toBe('available')
})
it('checkForUpdate detects a Flatpak branch switch independently of semver', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  ;(invoke as any).mockClear()
  h.flatpak = true
  h.flatpakChannel = 'beta'
  availableUpdate.set(null); updatePhase.set('idle')
  await checkForUpdate()
  expect(get(availableUpdate)?.channelSwitch).toBe('stable')
  expect(get(availableUpdate)?.notes).toContain('beta Flatpak channel')
  expect(invoke).toHaveBeenCalledWith('flatpak_current_channel')
  expect(get(updatePhase)).toBe('available')
})
it('checkForUpdate is a no-op when up to date', async () => {
  // updater_check returns null -> no update. checkForUpdate makes two invoke calls on the
  // desktop path (is_flatpak in pickTarget, then updater_check), so null out both for this
  // check; the default mock is restored afterwards.
  const { invoke } = await import('@tauri-apps/api/core')
  ;(invoke as any)
    .mockImplementationOnce(async () => null) // is_flatpak -> desktop
    .mockImplementationOnce(async () => null) // updater_check -> no update
  availableUpdate.set(null); updatePhase.set('idle')
  await checkForUpdate()
  expect(get(availableUpdate)).toBeNull()
  expect(get(updatePhase)).toBe('idle')
})

import { applyUpdate, updateError, updateProgress } from './index'

it('applyUpdate on desktop calls updater_install then reaches ready', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'desktop' })
  await applyUpdate()
  expect(invoke).toHaveBeenCalledWith('updater_install', { channel: expect.anything() })
  // desktop restarts itself in-process; phase advances through downloading
  expect(['downloading', 'ready']).toContain(get(updatePhase))
})
// The desktop Rust callback used to drop every chunk, so the toast bar sat at 0% for the whole
// download. It now emits `update-download-progress`; the facade has to map that onto the stores.
it('applyUpdate maps download progress onto the progress stores', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  const { updateBytes } = await import('./index')
  // Hold updater_install open so the listener is still live while progress is emitted.
  let release: () => void = () => {}
  ;(invoke as any).mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'desktop' })
  updatePhase.set('idle')
  const done = applyUpdate()
  await Promise.resolve() // let listenSafe register

  const fire = (downloaded: number, total: number | null) =>
    h.handlers.get('update-download-progress')?.({ payload: { downloaded, total } })

  fire(512, 2048)
  expect(get(updateProgress)).toBe(0.25)
  expect(get(updateBytes)).toBe(512)
  // No Content-Length -> indeterminate (fraction stays 0) but the byte counter still moves.
  fire(4096, null)
  expect(get(updateProgress)).toBe(0)
  expect(get(updateBytes)).toBe(4096)

  release()
  await done
  expect(get(updateProgress)).toBe(1)
})

it('applyUpdate on flatpak uses the portal + ends in ready (no relaunch)', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'flatpak' })
  updatePhase.set('idle')
  await applyUpdate()
  expect(invoke).toHaveBeenCalledWith('flatpak_update_install', { channel: expect.anything() })
  expect(get(updatePhase)).toBe('ready')
  expect(get(updateError)).toBe('')
})

// Rust tries the portal and host fallback before rejecting. In Game mode there is no browser to
// send the user to, so the final backend error stays in-app without obsolete manual steps.
it('applyUpdate on flatpak surfaces the reason in Game mode instead of opening a browser', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  ;(openUrl as any).mockClear()
  ;(invoke as any).mockImplementationOnce(async () => { throw new Error('the portal refused the update') })
  h.gameMode = true
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'flatpak' })
  updatePhase.set('idle'); updateError.set('')
  await applyUpdate()
  expect(openUrl).not.toHaveBeenCalled()
  expect(get(updatePhase)).toBe('error')
  expect(get(updateError)).toContain('the portal refused the update')
  expect(get(updateError)).not.toContain('Switch to Desktop Mode')
})

it('applyUpdate on flatpak still falls back to the release page outside Game mode', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  ;(openUrl as any).mockClear()
  ;(invoke as any).mockImplementationOnce(async () => { throw new Error('nope') })
  h.gameMode = false
  availableUpdate.set({ version: '0.2.0', notes: '', target: 'flatpak' })
  updatePhase.set('idle'); updateError.set('')
  await applyUpdate()
  expect(openUrl).toHaveBeenCalled()
  expect(get(updatePhase)).toBe('idle')
})

// append to updater.test.ts — fake timers drive the schedule
it('startUpdateChecks runs an initial check after the delay', async () => {
  vi.useFakeTimers()
  const { startUpdateChecks } = await import('./index')
  availableUpdate.set(null); updatePhase.set('idle')
  const stop = startUpdateChecks()
  await vi.advanceTimersByTimeAsync(5001)
  expect(get(updatePhase)).toBe('available')
  stop(); vi.useRealTimers()
})

// --- re-surface scheduler: rate limiting, playback exit, focus/visibility, dismissal memory ---

import { requestUpdateCheck, startUpdateChecks as startChecks, updateDismissed, __resetUpdateStateForTests } from './index'

// Drive the playback stores the way the app does: set + notify every live subscriber.
const setPlaying = (v: boolean) => { h.playing = v; h.playingSubs.forEach((f) => f(v)) }
const setMpvActive = (v: boolean) => { h.androidMpvActive = v; h.mpvSubs.forEach((f) => f(v)) }

it('requestUpdateCheck is rate-limited within its interval', async () => {
  vi.useFakeTimers()
  const { invoke } = await import('@tauri-apps/api/core')
  __resetUpdateStateForTests()
  ;(invoke as any).mockClear()
  requestUpdateCheck()
  const afterFirst = (invoke as any).mock.calls.length
  expect(afterFirst).toBeGreaterThan(0) // desktop path: is_flatpak + updater_check
  requestUpdateCheck() // same instant — inside the 30m window, must not touch the network
  expect((invoke as any).mock.calls.length).toBe(afterFirst)
  vi.advanceTimersByTime(31 * 60_000) // past the window -> the next request really checks
  requestUpdateCheck()
  expect((invoke as any).mock.calls.length).toBeGreaterThan(afterFirst)
  vi.useRealTimers()
})

it('exiting playback re-surfaces a dismissed update + fires a rate-limited re-check', async () => {
  vi.useFakeTimers()
  const { invoke } = await import('@tauri-apps/api/core')
  __resetUpdateStateForTests()
  availableUpdate.set(null); updatePhase.set('idle')
  await checkForUpdate() // offer 0.2.0
  updateDismissed.set(true)
  const stop = startChecks() // subscribes while not playing
  setPlaying(true)
  setPlaying(false) // user clicks out of the anime
  expect(get(updateDismissed)).toBe(false) // the toast is back
  const callsAfterExit = (invoke as any).mock.calls.length
  expect(callsAfterExit).toBeGreaterThan(0)
  // A second exit inside the window re-surfaces again but must not re-hit the network.
  updateDismissed.set(true)
  setPlaying(true)
  setPlaying(false)
  expect(get(updateDismissed)).toBe(false)
  expect((invoke as any).mock.calls.length).toBe(callsAfterExit)
  stop(); vi.useRealTimers()
})

it('closing the Android mpv surface re-surfaces the same way', async () => {
  vi.useFakeTimers()
  __resetUpdateStateForTests()
  availableUpdate.set(null); updatePhase.set('idle')
  await checkForUpdate()
  updateDismissed.set(true)
  const stop = startChecks()
  setMpvActive(true)
  setMpvActive(false)
  expect(get(updateDismissed)).toBe(false)
  stop(); vi.useRealTimers()
})

it('a newly detected version clears the dismissal; the same one keeps it', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  __resetUpdateStateForTests()
  availableUpdate.set(null); updatePhase.set('idle')
  await checkForUpdate() // 0.2.0 offered
  updateDismissed.set(true)
  // Re-detecting the SAME release keeps the dismissal — no re-nagging about an already-seen version.
  ;(invoke as any)
    .mockImplementationOnce(async () => null) // is_flatpak -> desktop
    .mockImplementationOnce(async () => ({ version: '0.2.0', current: '0.1.3', notes: 'x', date: null }))
  await checkForUpdate()
  expect(get(updateDismissed)).toBe(true)
  // A DIFFERENT (newer) release re-surfaces the toast.
  ;(invoke as any)
    .mockImplementationOnce(async () => null)
    .mockImplementationOnce(async () => ({ version: '0.3.0', current: '0.1.3', notes: 'x', date: null }))
  await checkForUpdate()
  expect(get(availableUpdate)?.version).toBe('0.3.0')
  expect(get(updateDismissed)).toBe(false)
})

it('visibilitychange + focus trigger rate-limited checks; stop() removes the listeners', async () => {
  vi.useFakeTimers()
  // Node has no DOM: stub the minimum surface the scheduler registers against.
  const listeners = new Map<string, () => void>()
  const track = (n: string, f: () => void) => listeners.set(n, f)
  const untrack = (n: string) => { listeners.delete(n) }
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: track, removeEventListener: untrack })
  vi.stubGlobal('window', { addEventListener: track, removeEventListener: untrack })
  const { invoke } = await import('@tauri-apps/api/core')
  __resetUpdateStateForTests()
  ;(invoke as any).mockClear()
  const stop = startChecks()
  expect(listeners.has('visibilitychange')).toBe(true)
  expect(listeners.has('focus')).toBe(true)

  listeners.get('visibilitychange')?.()
  const afterFirst = (invoke as any).mock.calls.length
  expect(afterFirst).toBeGreaterThan(0)
  listeners.get('focus')?.() // same instant -> rate-limited
  expect((invoke as any).mock.calls.length).toBe(afterFirst)

  stop()
  expect(listeners.size).toBe(0) // every listener is undone
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
