import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { settingsSection } from '$lib/settings/sections'
import { SETTINGS_SEARCH_INDEX } from '$lib/settings/search'
import { sectionOf, subcategoriesOf, subcategoryKeys } from '../../../../test/settings-sections'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const read = (path: string) => readFileSync(here(path), 'utf8').replace(/\r\n/g, '\n')
const file = here('./+page.svelte')
const page = read('./+page.svelte')
const backup = read('../../../../lib/components/settings/BackupRestore.svelte')
const cloudflare = read('../../../../lib/sync/cloudflare.ts')
const nativeCloudflare = read('../../../../../src-tauri/src/cloudflare_deploy.rs')
const keysIn = (id: string) => subcategoryKeys(file, subcategoriesOf(file).find((sub) => sub.id === id)!)
const BASE = 'https://izumi.invalid'

describe('Devices and backup section', () => {
  it('is a SettingsSection page with no title of its own', () => {
    expect(sectionOf(file)).toBe('devices')
    expect(page).not.toContain('data-settings-page-title')
  })

  it('renders Devices, TV connections, Backup, Transfer and a folded Advanced in order', () => {
    const subcategories = subcategoriesOf(file)
    expect(subcategories.map((sub) => sub.id)).toEqual(settingsSection('devices').subcategories.map((sub) => sub.id))
    expect(subcategories.at(-1)!.summary).toBe('Connection method, Worker updates, pairing ticket, relay')
    expect(page).not.toContain('data-page-tabs')
    expect(page).not.toContain('SettingsGroup')
    expect(page).not.toContain('<details')
  })

  it('renders every Devices search key inside its subcategory', () => {
    const entries = SETTINGS_SEARCH_INDEX.filter((item) => item.section === 'devices' && item.key)
    expect(entries.map((item) => item.key).sort()).toEqual([
      'add-a-device', 'create-backup', 'device-name', 'device-sync', 'pairing-ticket', 'peer-to-peer-relay', 'settings-and-sources-sync',
      'sync-connection', 'tv-pairing', 'tv-playback-worker', 'watch-progress-sync', 'worker-updates',
    ])
    for (const item of entries) {
      const keys = [...keysIn(item.subcategory)]
      expect(new URL(item.href, BASE).pathname, item.title).toBe('/app/settings/devices')
      expect(keys, item.title).toContain(item.key)
      if (item.fallbackKey) expect(keys, item.title).toContain(item.fallbackKey)
      expect(item.advanced === true, item.title).toBe(item.subcategory === 'advanced')
    }
  })

  it('keys the status row of every settled sync state, so state-only rows fall back to it', () => {
    const devices = subcategoriesOf(file).find((sub) => sub.id === 'devices')!.source
    for (const title of ['Self-hosted sync is off', 'Couldn’t reach your Worker', 'Cloudflare sync', 'Device sync is off', 'Couldn’t start sync', 'Start my own']) {
      expect(devices, title).toContain(`settingKey="device-sync" title="${title}"`)
    }
    expect(devices).toMatch(/settingKey="device-sync" title="\{roomDeviceCount\}[^"]*syncing"/)
    expect(devices).toMatch(/settingKey="device-sync" title="\{roomDeviceCount\}[^"]*connected"/)
    // A starting row would win the fallback before the real state renders.
    expect(devices).not.toMatch(/settingKey="device-sync" title="(Connecting|Starting)/)
    for (const key of ['device-name', 'watch-progress-sync', 'add-a-device']) {
      expect(SETTINGS_SEARCH_INDEX.find((item) => item.key === key)?.fallbackKey, key).toBe('device-sync')
    }
  })

  it('unfolds Advanced while a Worker update is waiting', () => {
    expect(page).toContain('let advancedOpen = $state(false)')
    expect(page).toMatch(/\$effect\(\(\) => \{\s*if \(\$cloudflareWorkerUpdateAvailable\) advancedOpen = true\s*\}\)/)
    expect(page).toContain('summary="Connection method, Worker updates, pairing ticket, relay" bind:open={advancedOpen}')
  })

  it('gives a resolver switch row one haptic and dims the switch while busy', () => {
    expect(page).toContain('onActivate={() => { if (!busy) toggleCloudResolverConnectedDevices() }}')
    expect(page).toContain('onActivate={() => { if (!busy) $cloudflareAllowLanSources = !$cloudflareAllowLanSources }}')
    expect(page.match(/<span class=\{busy \? 'opacity-50' : ''\}><SettingsSwitch/g)).toHaveLength(2)
  })

  it('truncates the Worker endpoint instead of letting it overflow the row', () => {
    expect(page).toContain('<span class="block truncate">Worker connected · {$cloudflareSyncConfig.endpoint}</span>')
    expect(page).toContain('meta={workerMeta}')
    expect(page).not.toContain('description="Worker connected')
  })

  it('gives every row key a search entry', () => {
    const indexed = new Set(SETTINGS_SEARCH_INDEX.flatMap((item) => [item.key, item.fallbackKey]))
    for (const sub of subcategoriesOf(file)) for (const key of subcategoryKeys(file, sub)) expect(indexed.has(key), `${sub.id}: ${key}`).toBe(true)
  })

  it('moves the peer-to-peer relay into Devices › Advanced', () => {
    expect(keysIn('advanced').has('peer-to-peer-relay')).toBe(true)
    expect(page).toContain("await setSyncRelay($syncRelayMode === 'custom' ? $syncRelayUrl : null)")
    expect(page).toContain('void getSyncRelayConfig().then((config) => {')
  })

  it('keeps first-time setup, joining and the off state', () => {
    expect(page).toContain("cloudSetup === 'create'")
    expect(page).toContain('Set up for the first time')
    expect(page).toContain('Join my devices')
    expect(page).toContain('Enable device sync')
    expect(page).toContain('Device sync is off')
    expect(page).not.toContain('How do you want to set up sync?')
    expect(page).not.toContain('setupChoice')
  })

  it('shows nearby sessions and starting your own on the same lobby', () => {
    expect(page).toContain('title="Start my own"')
    expect(page).toContain('Looking for devices')
    expect(page.indexOf('title="Start my own"')).toBeLessThan(page.indexOf('title="Looking for devices…"'))
    expect(page).toContain("import Ticket from '@lucide/svelte/icons/ticket'")
    expect(page).toContain('leading={ticketIcon}')
    expect(page).not.toContain('No sessions yet')
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

  it('gives an active room a clear status, its devices and the extras below them', () => {
    expect(page).toContain('settingKey="add-a-device"')
    expect(page).toContain('waitingNearby')
    expect(page).toContain('listSyncMembers')
    expect(page).toContain('Watch progress syncs')
    const room = page.slice(page.indexOf('Room active'))
    expect(room.indexOf('Room active')).toBeLessThan(room.indexOf('title="Devices"'))
    expect(room.indexOf('title="Devices"')).toBeLessThan(room.indexOf('Syncing automatically'))
    expect(room.indexOf('Syncing automatically')).toBeLessThan(room.indexOf('settingKey="add-a-device"'))
    expect(room.indexOf('settingKey="add-a-device"')).toBeLessThan(room.indexOf('title="Leave room"'))
    expect(page).not.toContain('Sync now')
  })

  it('keeps settings transfer under Transfer, with one Share button, and links history import/export', () => {
    expect(keysIn('transfer').has('settings-and-sources-sync')).toBe(true)
    expect(page.match(/\{ h\.impact\(\); sendManual\(\) \}/g)).toHaveLength(1)
    expect(page).toContain('href="/app/settings/library?setting=import-export-history"')
  })

  it('opens the connection choice from the TV hint by unfolding Advanced', () => {
    expect(page).toContain("document.getElementById('advanced')?.dispatchEvent(new CustomEvent(SUBCATEGORY_OPEN_EVENT))")
    expect(page).toContain('id="cloudflare-connection" class:cloudflare-setup-highlight={highlightCloudflare}')
  })

  it('keeps every description to one short line', () => {
    const literals = (source: string) => [
      ...[...source.matchAll(/\sdescription="([^"]*)"/g)].map((match) => match[1]),
      // String literals inside a one-line description={…} expression.
      ...[...source.matchAll(/\sdescription=\{([^\n]*)\}/g)].flatMap((match) => [...match[1].matchAll(/'([^']*)'/g)].map((inner) => inner[1])),
    ]
    for (const source of [page, backup]) for (const text of literals(source)) {
      expect(text.length, text).toBeLessThanOrEqual(80)
      expect(text, text).not.toMatch(/\.$/)
    }
    expect(page).not.toMatch(/text-\[1[01]px\]/)
  })

  it('deploys a claimable private Cloudflare Worker without setup fields or GitHub', () => {
    expect(page).toContain('No GitHub, repository, command line, token, or technical fields.')
    expect(page).toContain("'cloudflare_create_preview'")
    expect(page).toContain('I accept Cloudflare’s')
    expect(page).toContain('I claimed it — connect')
    expect(page).toContain("invoke<{ id: string; name: string }[]>('cloudflare_deployment_accounts'")
    expect(page).toContain("'cloudflare_deploy_worker'")
    expect(page).toContain("'cloudflare_remove_bootstrap_secret'")
    expect(page.indexOf('Create my private Worker')).toBeLessThan(page.indexOf('Create setup token'))
    expect(page.indexOf('Create my private Worker')).toBeLessThan(page.indexOf('Optional Git-based deploy'))
    expect(cloudflare).toContain('%22key%22%3A%22workers_scripts%22')
    expect(cloudflare).toContain('%22key%22%3A%22d1%22')
    expect(cloudflare).toContain('%22key%22%3A%22account_settings%22')
    expect(nativeCloudflare).toContain('/provisioning/previews/challenge')
    expect(nativeCloudflare).toContain('/provisioning/previews')
    expect(nativeCloudflare).toContain('"acceptTermsOfService": "yes"')
    expect(nativeCloudflare).toContain('solve_preview_challenge')
    expect(nativeCloudflare).toContain('POST')
    expect(nativeCloudflare).toContain('/d1/database')
    expect(nativeCloudflare).toContain('multipart::Form::new()')
    expect(nativeCloudflare).toContain('"type": "secret_text"')
  })
})
