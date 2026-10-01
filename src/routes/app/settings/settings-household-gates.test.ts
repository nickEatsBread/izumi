import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { openingTagAt } from '../../../test/svelte-source'

// Restricted profiles (a non-main profile while the main profile has a PIN) need the main PIN for
// household actions (spec §6.5-6.6). The pages ask with authorizeHousehold; the functions check
// with assertHouseholdAction. Every page that asks cancels a prompt still pending when it closes.
// These pins keep all three in place.

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

/** From `header` to its closing brace at `indent` (two spaces in a Svelte script, none at module level). */
function functionBody(source: string, header: string, indent = '  '): string {
  const start = source.indexOf(header)
  expect(start, `missing: ${header}`).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(`\n${indent}}\n`, start)
  expect(end, `no closing brace for: ${header}`).toBeGreaterThan(start)
  return source.slice(start, end)
}

/** The first statement inside a function body. */
function firstStatement(body: string): string {
  return body.slice(body.indexOf('{\n') + 2).trimStart().split('\n')[0].trim()
}

describe('household backups', () => {
  const page = read('./backup/+page.svelte')
  const backup = read('../../../lib/backup.ts')

  it('asks for the main PIN before saving or restoring, and ignores a second press meanwhile', () => {
    const helper = functionBody(page, 'async function authorized(')
    expect(helper).toContain('if (authorizing) return false')
    expect(helper).toContain('return await authorizeHousehold(action)')
    const save = functionBody(page, 'async function exportBackup()')
    expect(firstStatement(save)).toBe("if (!(await authorized('backup-export'))) return")
    expect(save.indexOf("authorized('backup-export')")).toBeLessThan(save.indexOf('stringifyBackup('))
    const restore = functionBody(page, 'async function applyRestore()')
    expect(restore).toContain("if (!(await authorized('backup-restore'))) return")
    expect(restore.indexOf("authorized('backup-restore')")).toBeLessThan(restore.indexOf('restoreBackup('))
    expect(restore).toContain('restoreBackup(localStorage, backup)')
  })

  it('cancels a PIN prompt still pending when the page closes', () => {
    expect(page).toContain("import { onDestroy } from 'svelte'")
    expect(page).toContain("import { authorizeHousehold, cancelHouseholdPrompt } from '$lib/profiles/household-gate'")
    expect(page).toContain('onDestroy(cancelHouseholdPrompt)')
  })

  it('checks the grant first thing inside the backup functions themselves', () => {
    expect(firstStatement(functionBody(backup, 'export async function stringifyBackup(', ''))).toBe("assertHouseholdAction('backup-export')")
    expect(firstStatement(functionBody(backup, 'export async function restoreBackup(', ''))).toBe("assertHouseholdAction('backup-restore')")
  })
})

describe('factory reset', () => {
  const about = read('./about/+page.svelte')

  it('asks for the main PIN, once, before starting the reset', () => {
    const reset = functionBody(about, 'async function resetToDefaults()')
    expect(firstStatement(reset)).toBe('if (!confirmReset || resetting || authorizing) return')
    expect(about).toContain('let authorizing = false')
    expect(reset).toContain("allowed = await authorizeHousehold('factory-reset')")
    expect(reset).toContain('if (!allowed) return')
    expect(reset.indexOf("authorizeHousehold('factory-reset')")).toBeLessThan(reset.indexOf('startFactoryReset()'))
  })

  it('cancels a PIN prompt still pending when the page closes', () => {
    expect(about).toContain("import { onDestroy, onMount } from 'svelte'")
    expect(about).toContain("import { authorizeHousehold, cancelHouseholdPrompt } from '$lib/profiles/household-gate'")
    expect(about).toContain('onDestroy(cancelHouseholdPrompt)')
  })

  it('starts the reset only through startFactoryReset, which checks the grant', () => {
    expect(about).toContain("import { startFactoryReset } from '$lib/storage/factory-reset'")
    expect(about).not.toContain("sessionStorage.setItem('izumi-reset-requested'")
    expect(about).not.toContain("location.replace('/reset.html')")
    expect(read('../../../lib/storage/factory-reset.ts')).toContain("assertHouseholdAction('factory-reset')")
  })
})

describe("sending this device's setup", () => {
  const page = read('./sync/+page.svelte')
  const client = read('../../../lib/sync/client.ts')

  it('asks for the main PIN before `action` marks the page busy, and before anything is offered', () => {
    // `action` sets `busy`, which disables and relabels the Send setup button. Asking inside it
    // would leave the keypad nothing enabled to give focus back to on cancel.
    const confirm = functionBody(page, 'async function confirmSendSetup()')
    expect(page).toContain('let authorizingSend = false')
    expect(confirm).toContain('if (!device || busy || authorizingSend) return')
    expect(confirm).toContain("allowed = await authorizeHousehold('send-setup')")
    expect(confirm).toContain('if (!allowed || offerTarget !== device) return')
    expect(confirm.indexOf("authorizeHousehold('send-setup')")).toBeLessThan(confirm.indexOf('void action(`offer-'))
    expect(confirm.indexOf('void action(`offer-')).toBeLessThan(confirm.indexOf('offerSetupToDevice(device.endpointId)'))
  })

  it('cancels a PIN prompt still pending when the page closes', () => {
    expect(page).toContain("import { onDestroy, onMount, tick } from 'svelte'")
    expect(page).toContain("import { authorizeHousehold, cancelHouseholdPrompt } from '$lib/profiles/household-gate'")
    expect(page).toContain('onDestroy(cancelHouseholdPrompt)')
  })

  it('checks the grant first thing in offerSetupToDevice', () => {
    expect(firstStatement(functionBody(client, 'export async function offerSetupToDevice(', ''))).toBe("assertHouseholdAction('send-setup');")
  })
})

describe('18+ sources', () => {
  const extensions = read('./extensions/+page.svelte')
  const store = read('./store/+page.svelte')
  const cancelAndLock = 'onDestroy(() => { cancelHouseholdPrompt(); lockAdultSources() })'

  it('replaces the Adult sources checkbox with a focusable switch that asks for the PIN', () => {
    expect(extensions).not.toContain('bind:checked={showNsfw}')
    expect(extensions).toContain('const adultShown = $derived(showNsfw && $adultSourcesAllowed)')
    expect(extensions).toContain('if (extension.nsfw && !adultShown) return false')
    const toggle = functionBody(extensions, 'async function toggleAdultSources()')
    expect(toggle).toContain('lockAdultSources()')
    expect(toggle).toContain('showNsfw = await requestAdultSources()')
    const at = extensions.indexOf('onclick={() => void toggleAdultSources()}')
    expect(at).toBeGreaterThan(0)
    const tag = openingTagAt(extensions, at)
    for (const marker of ['type="button"', 'data-focusable', 'data-switch', 'role="switch"', 'aria-checked={adultShown}', 'aria-label="Adult sources"']) {
      expect(tag).toContain(marker)
    }
    expect(tag).not.toMatch(/\sdisabled=/)
  })

  it('cancels a PIN prompt still pending and locks 18+ sources again when either page closes', () => {
    const gateImport = "import { adultSourcesAllowed, cancelHouseholdPrompt, lockAdultSources, requestAdultSources } from '$lib/profiles/household-gate'"
    expect(extensions).toContain("import { onDestroy } from 'svelte'")
    expect(extensions).toContain(gateImport)
    expect(extensions).toContain(cancelAndLock)
    expect(store).toContain("import { onDestroy, onMount, untrack } from 'svelte'")
    expect(store).toContain(gateImport)
    expect(store).toContain(cancelAndLock)
  })

  it('filters the Store by the unlock and keeps a focusable 18+ toggle on screen for restricted profiles', () => {
    expect(store).toContain('showAdult: $showAdult && $adultSourcesAllowed,')
    expect(store).toContain("import { householdLocked } from '$lib/profiles/store'")
    const at = store.indexOf('onclick={() => ($adultSourcesAllowed ? lockAdultSources() : void requestAdultSources())}')
    expect(at).toBeGreaterThan(0)
    expect(store.lastIndexOf('{#if $showAdult && $householdLocked}', at)).toBeGreaterThan(-1)
    const tag = openingTagAt(store, at)
    expect(tag).toContain('type="button"')
    expect(tag).toContain('data-focusable')
    expect(tag).toContain('aria-pressed={$adultSourcesAllowed}')
    expect(tag).not.toMatch(/\sdisabled=/)
    expect(store.slice(at, store.indexOf('</button>', at))).toContain('Show 18+ sources')
    // Never hidden by its own unlock: the PIN dialog gives focus back to it.
    expect(store).not.toContain('!$adultSourcesAllowed}')
  })
})
