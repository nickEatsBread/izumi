import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('Device sync screen', () => {
  it('starts from the old off-state, not a setup wizard', () => {
    expect(page).toContain('Enable device sync')
    expect(page).toContain('Device sync is off')
    expect(page).not.toContain('How do you want to set up sync?')
    expect(page).not.toContain('Start a new sync group')
    expect(page).not.toContain('Join my existing devices')
    expect(page).not.toContain('setupChoice')
  })

  it('shows nearby sessions and starting your own on the same lobby', () => {
    expect(page).toContain('Nearby sessions')
    expect(page).toContain('Start my own')
    expect(page).toContain('Advanced: pairing ticket')
    expect(page).toContain("import Ticket from '@lucide/svelte/icons/ticket'")
    expect(page).toContain('leading={ticketIcon}')
    expect(page).toContain('Looking for hosts')
    expect(page.indexOf('title="Start my own"')).toBeLessThan(page.indexOf('title="Looking for hosts…"'))
    expect(page).not.toContain('No sessions yet')
    expect(page).not.toContain('>Scan<')
    expect(page).not.toContain('On this device')
    expect(page).not.toContain('size="lg"')
    expect(page).not.toContain('controlLayout="stack"')
  })

  it('drops a pairing confirmation when sync is turned off or back on', () => {
    const reset = page.slice(page.indexOf('function resetPairingUi'), page.indexOf('function enable'))
    const enable = page.slice(page.indexOf('function enable'), page.indexOf('function disable'))
    const disable = page.slice(page.indexOf('function disable'), page.indexOf('async function refreshNearby'))
    expect(reset).toContain('outgoing = null')
    expect(reset).toContain('incoming = null')
    expect(enable).toContain('resetPairingUi()')
    expect(disable).toContain('resetPairingUi()')
  })

  it('uses an expiring toast for confirmations while keeping errors inline', () => {
    expect(page).toContain('function showMessage(text: string)')
    expect(page).toContain('}, 4000)')
    expect(page).toContain('pointer-events-none fixed inset-x-4 bottom-20')
    expect(page).toContain('role="status" aria-live="polite"')
    expect(page).toContain('role="alert"')
    expect(page).toContain("showMessage('Nearby pairing is open for two minutes.')")
    expect(page).toContain("showMessage('This device left the sync group. Your other devices remain paired.')")
  })

  it('gives an active room a clear status, device hierarchy, and tucked-away extras', () => {
    expect(page).toContain('Add a device')
    expect(page).toContain('Room active')
    expect(page).toContain('Devices')
    expect(page).toContain('Syncing automatically')
    expect(page).toContain('Advanced tools')
    expect(page).toContain('Leave room')
    expect(page).toContain('listSyncMembers')
    expect(page).toContain('This device')
    expect(page).toContain('Watch progress syncs')
    expect(page).toContain('data-setting-key="device-name"')
    expect(page).toContain('data-setting-key="watch-progress-sync"')
    expect(page).toContain('data-setting-key="settings-and-sources-sync"')
    expect(page).not.toContain('Automatic sync')
    expect(page).not.toContain('Group membership')
    expect(page).not.toContain('Sync now')
    expect(page).not.toContain('<SettingsGroup title="In a room"')
    const room = page.slice(page.indexOf('Room active'))
    expect(room.indexOf('Room active')).toBeLessThan(room.indexOf('>Devices<'))
    expect(room.indexOf('>Devices<')).toBeLessThan(room.indexOf('Syncing automatically'))
    expect(room.indexOf('Syncing automatically')).toBeLessThan(room.indexOf('Advanced tools'))
    expect(room.indexOf('Advanced tools')).toBeLessThan(room.indexOf('Leave room'))
  })
})
