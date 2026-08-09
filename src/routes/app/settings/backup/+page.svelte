<script lang="ts">
  import Download from '@lucide/svelte/icons/download'
  import Upload from '@lucide/svelte/icons/upload'
  import ShieldAlert from '@lucide/svelte/icons/shield-alert'
  import { parseBackup, restoreBackup, stringifyBackup, type AppBackup } from '$lib/backup'
  import { ioErrorMessage, saveTextFile } from '$lib/player/history-io'
  import Toggle from '$lib/components/settings/Toggle.svelte'

  let includeSecrets = $state(false)
  let message = $state('')
  let fileInput = $state<HTMLInputElement>()
  let pending = $state<AppBackup | null>(null)
  let pendingName = $state('')

  async function exportBackup() {
    try {
      const saved = await saveTextFile(
        `izumi-backup-${new Date().toISOString().slice(0, 10)}.json`,
        stringifyBackup(localStorage, includeSecrets),
      )
      if (saved) message = 'Application backup saved.'
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

  function applyRestore() {
    if (!pending) return
    try {
      const count = restoreBackup(localStorage, pending)
      message = `Restored ${count} values. Restarting Izumi…`
      pending = null
      setTimeout(() => location.reload(), 350)
    } catch (error) {
      message = ioErrorMessage(error, 'Restore failed.')
    }
  }
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Backup &amp; restore</h2>
  <p class="mb-6 max-w-2xl text-sm text-muted-foreground">Move the whole Izumi setup: interface and player settings, navigation, extensions and add-ons, downloads metadata, watch history, and resume positions.</p>

  <div class="max-w-2xl space-y-5">
    <section class="rounded-xl border border-border p-4">
      <h3 class="font-black">Create application backup</h3>
      <p class="mb-3 mt-1 text-xs text-muted-foreground">Account tokens, passwords, API keys, and debrid credentials are excluded unless you explicitly include them.</p>
      <div class="mb-3">
        <Toggle
          label="Include accounts and secrets"
          desc="Produces a sensitive file that can sign another installation into your services. Store it securely."
          value={includeSecrets}
          onToggle={() => (includeSecrets = !includeSecrets)}
        />
      </div>
      {#if includeSecrets}
        <div class="mb-3 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <ShieldAlert size={17} class="shrink-0" /> This backup contains credentials in readable form.
        </div>
      {/if}
      <button data-focusable onclick={exportBackup} class="flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">
        <Download size={16} /> Save backup
      </button>
    </section>

    <section class="rounded-xl border border-border p-4">
      <h3 class="font-black">Restore application backup</h3>
      <p class="mb-3 mt-1 text-xs text-muted-foreground">Imported values overwrite matching settings. Other values remain unchanged. Izumi reloads after a successful restore.</p>
      <button data-focusable onclick={() => fileInput?.click()} class="flex items-center gap-2 rounded-md bg-secondary px-4 py-2 font-bold hover:bg-accent">
        <Upload size={16} /> Choose backup
      </button>
      <input bind:this={fileInput} onchange={chooseBackup} type="file" accept="application/json,.json" class="hidden" />

      {#if pending}
        <div class="mt-4 rounded-md border border-theme/40 bg-theme/10 p-3">
          <div class="font-bold">{pendingName}</div>
          <div class="mt-1 text-xs text-muted-foreground">
            {Object.keys(pending.localStorage).length} values · exported {new Date(pending.exportedAt).toLocaleString()}
            {pending.includesSecrets ? ' · includes secrets' : ''}
          </div>
          <div class="mt-3 flex gap-2">
            <button data-focusable onclick={applyRestore} class="rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground">Restore and restart</button>
            <button data-focusable onclick={() => (pending = null)} class="rounded-md border border-border px-3 py-2 text-sm font-bold">Cancel</button>
          </div>
        </div>
      {/if}
    </section>
    {#if message}<p class="text-sm text-theme">{message}</p>{/if}
  </div>
</div>
