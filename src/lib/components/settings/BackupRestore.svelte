<script lang="ts">
  import Download from '@lucide/svelte/icons/download'
  import Upload from '@lucide/svelte/icons/upload'
  import ShieldAlert from '@lucide/svelte/icons/shield-alert'
  import { parseBackup, restoreBackup, stringifyBackup, type AppBackup } from '$lib/backup'
  import { baseStorageKey } from '$lib/storage/key-policy'
  import { ioErrorMessage, saveTextFile } from '$lib/player/history-io'
  import { onDestroy } from 'svelte'
  import { authorizeHousehold, cancelHouseholdPrompt } from '$lib/profiles/household-gate'
  import SettingsRow from './SettingsRow.svelte'
  import SettingsSwitch from './SettingsSwitch.svelte'

  let includeSecrets = $state(false)
  let message = $state('')
  let fileInput = $state<HTMLInputElement>()
  let pending = $state<AppBackup | null>(null)
  let pendingName = $state('')
  // True while the main-PIN keypad is up on a restricted profile; a second press is ignored, since a
  // grant is good for one call only.
  let authorizing = false

  /** Restricted profiles need the main profile's PIN before a household backup is saved or
   *  restored. Everyone else passes straight through. */
  async function authorized(action: 'backup-export' | 'backup-restore'): Promise<boolean> {
    if (authorizing) return false
    authorizing = true
    try {
      return await authorizeHousehold(action)
    } finally {
      authorizing = false
    }
  }
  // Leaving the page while the keypad is still loading or up cancels it, so a PIN entered later
  // cannot save or restore from a page that is gone.
  onDestroy(cancelHouseholdPrompt)

  /** Spec §6.2: after saving, say how many settings the storage-key policy kept out of the file. */
  function savedMessage(text: string): string {
    const leftOut = (JSON.parse(text) as AppBackup).redacted?.keys.length ?? 0
    if (leftOut === 0) return 'Application backup saved.'
    if (leftOut === 1) return 'Application backup saved. 1 setting was left out because it holds a sign-in, key or password.'
    return `Application backup saved. ${leftOut} settings were left out because they hold a sign-in, key or password.`
  }

  /** Every profile's copy of a key reads as the key itself in the restore preview. */
  function leftOutNames(keys: readonly string[]): string {
    return [...new Set(keys.map(baseStorageKey))].join(', ')
  }

  async function exportBackup() {
    if (!(await authorized('backup-export'))) return
    try {
      const text = await stringifyBackup(localStorage, includeSecrets)
      const saved = await saveTextFile(`izumi-backup-${new Date().toISOString().slice(0, 10)}.json`, text)
      if (saved) message = savedMessage(text)
    } catch (error) {
      message = ioErrorMessage(error, 'Backup failed.')
    }
  }

  async function chooseBackup(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      pending = parseBackup(await file.text())
      pendingName = file.name
      message = ''
    } catch (error) {
      pending = null
      message = ioErrorMessage(error, 'Invalid backup.')
    }
  }

  async function applyRestore() {
    const backup = pending
    if (!backup) return
    if (!(await authorized('backup-restore'))) return
    try {
      const count = await restoreBackup(localStorage, backup)
      message = `Restored ${count} values. Restarting Izumi…`
      pending = null
      setTimeout(() => location.reload(), 350)
    } catch (error) {
      message = ioErrorMessage(error, 'Restore failed.')
    }
  }
</script>

{#snippet secretsSwitch()}
  <SettingsSwitch value={includeSecrets} onToggle={() => (includeSecrets = !includeSecrets)} label="Include accounts and secrets" interactive={false} />
{/snippet}
{#snippet saveControl()}
  <button type="button" data-focusable onclick={exportBackup} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground">
    <Download size={16} /> Save backup
  </button>
{/snippet}
{#snippet chooseControl()}
  <button type="button" data-focusable onclick={() => fileInput?.click()} class="inline-flex min-h-10 items-center gap-2 rounded-lg bg-secondary px-3 text-sm font-bold active:bg-accent sm:hover:bg-accent">
    <Upload size={16} /> Choose backup
  </button>
  <input bind:this={fileInput} onchange={chooseBackup} type="file" accept="application/json,.json" class="hidden" />
{/snippet}

<SettingsRow
  title="Include accounts and secrets"
  description="Makes a sensitive file that can sign in elsewhere; store it safely"
  control={secretsSwitch}
  onActivate={() => (includeSecrets = !includeSecrets)}
  pressed={includeSecrets}
/>
{#if includeSecrets}
  <p class="flex gap-2 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200"><ShieldAlert size={17} class="shrink-0" /> This backup contains credentials in readable form.</p>
{/if}
<SettingsRow
  settingKey="create-backup"
  title="Create application backup"
  description="Settings, sources, history and resume positions in one file"
  learnMore="Account tokens, passwords, API keys, and debrid credentials are excluded unless you explicitly include them. This device's sync membership and TV pairing are never included."
  control={saveControl}
/>
<SettingsRow
  title="Restore application backup"
  description="Overwrites matching settings, then restarts izumi"
  learnMore="Imported values overwrite matching settings. Other values remain unchanged."
  control={chooseControl}
  expanded={!!pending}
>
  {#if pending}
    <div class="rounded-md border border-theme/40 bg-theme/10 p-3">
      <div class="font-bold">{pendingName}</div>
      <div class="mt-1 text-xs text-muted-foreground">
        {Object.keys(pending.localStorage).length} values · exported {new Date(pending.exportedAt).toLocaleString()}
        {pending.includesSecrets ? ' · includes secrets' : ''}
      </div>
      {#if pending.redacted && pending.redacted.keys.length > 0}
        <p class="mt-2 text-xs text-muted-foreground">Left out of this file: {leftOutNames(pending.redacted.keys)}</p>
      {/if}
      {#each pending.redacted?.notes ?? [] as note (note)}
        <p class="mt-2 text-xs text-muted-foreground">{note}</p>
      {/each}
      <div class="mt-3 flex gap-2">
        <button type="button" data-focusable onclick={applyRestore} class="min-h-10 rounded-md bg-primary px-3 text-sm font-bold text-primary-foreground">Restore and restart</button>
        <button type="button" data-focusable onclick={() => (pending = null)} class="min-h-10 rounded-md border border-border px-3 text-sm font-bold">Cancel</button>
      </div>
    </div>
  {/if}
</SettingsRow>
{#if message}<p role="status" class="px-3 py-2.5 text-sm text-theme">{message}</p>{/if}
