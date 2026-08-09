import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nextOfflineMode } from './offline'

describe('nextOfflineMode', () => {
  it('always launches online, whatever the connectivity hint claims', () => {
    // navigator.onLine is a hint, not evidence: inside a Flatpak sandbox WebKitGTK reads host network
    // status through a portal the sandbox need not expose and reports false on a working network.
    // Booting into offline mode on that left every screen rendering its offline state — nothing
    // loaded, nothing was requested, and no error explained it. A wrong "offline" costs the user the
    // whole app; a wrong "online" costs one failed request and a banner offering the switch.
    expect(nextOfflineMode(false, { force: false, online: false, event: 'boot' })).toBe(false)
    expect(nextOfflineMode(false, { force: false, online: true, event: 'boot' })).toBe(false)
  })

  it('force always wins, regardless of connectivity or event', () => {
    for (const online of [true, false]) {
      for (const event of ['boot', 'force-change', 'connectivity'] as const) {
        expect(nextOfflineMode(false, { force: true, online, event })).toBe(true)
      }
    }
  })

  it('un-forcing goes online unconditionally', () => {
    // "Go online" has to actually go online. Re-latching on the hint made the button look broken to
    // anyone whose webview reports the wrong thing.
    expect(nextOfflineMode(true, { force: false, online: true, event: 'force-change' })).toBe(false)
    expect(nextOfflineMode(true, { force: false, online: false, event: 'force-change' })).toBe(false)
  })

  it('reconnect exits offline mode when not forced', () => {
    expect(nextOfflineMode(true, { force: false, online: true, event: 'connectivity' })).toBe(false)
  })

  it('a mid-session drop does NOT auto-enter — keeps prev', () => {
    expect(nextOfflineMode(false, { force: false, online: false, event: 'connectivity' })).toBe(false)
    expect(nextOfflineMode(true, { force: false, online: false, event: 'connectivity' })).toBe(true)
  })
})

describe('offline mode is only ever a deliberate choice', () => {
  const source = readFileSync(fileURLToPath(new URL('./offline.ts', import.meta.url)), 'utf8')

  it('never boots into offline mode on a hint, and never probes to decide', () => {
    // No boot-time request either: the app renders immediately rather than waiting on a probe.
    expect(source).not.toContain('probeOnline')
    expect(source).not.toContain("event: 'probe'")
    expect(source).toContain('return false // always start (and un-force) online')
  })

  it('keeps the user-forced latch as the one way in', () => {
    expect(source).toContain('if (force) return true')
    expect(source).toContain("export const forceOffline = persisted<boolean>('force-offline', false)")
  })
})
