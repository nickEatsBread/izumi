import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('watch-party host transfer UI contract', () => {
  it('offers a guarded transfer only from the current host to guests', () => {
    const page = read('src/routes/app/watch/+page.svelte')
    expect(page).toContain("$watchParty.role === 'host' && participant.role === 'guest'")
    expect(page).toContain("confirmTransferId === participant.deviceId ? 'Confirm' : 'Make host'")
    expect(page).toContain('transferWatchPartyHost(participant.deviceId)')
  })

  it('surfaces transfer progress and the new host in the player presence panel', () => {
    const page = read('src/routes/app/watch/+page.svelte')
    const presence = read('src/lib/components/watch/PartyPresence.svelte')
    expect(page).toContain('Host transfer · {$partyHostTransfer.targetName}')
    expect(presence).toContain("participant.role === 'host'")
    expect(presence).toContain('<Crown')
  })
})
