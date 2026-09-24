<script lang="ts">
  import Download from '@lucide/svelte/icons/download'
  import Upload from '@lucide/svelte/icons/upload'
  import ShieldAlert from '@lucide/svelte/icons/shield-alert'
  import HardDrive from '@lucide/svelte/icons/hard-drive'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import { onMount } from 'svelte'
  import { parseBackup, restoreBackup, stringifyBackup, type AppBackup } from '$lib/backup'
  import { ioErrorMessage, saveTextFile } from '$lib/player/history-io'
  import { hasTauriRuntime } from '$lib/platform'
  import {
    loadSnapshot, preferenceKeysToWipe, saveSnapshot, wipePreferences, type SnapshotMeta,
  } from '$lib/prefs-snapshot'
  import Toggle from '$lib/components/settings/Toggle.svelte'

  let includeSecrets = $state(false)
  let message = $state('')
  let fileInput = $state<HTMLInputElement>()
  let pending = $state<AppBackup | null>(null)
  let pendingName = $state('')

  const native = hasTauriRuntime()
  let snapshot = $state<SnapshotMeta | null>(null)
  let snapshotValues = $state(0)
  let snapshotBusy = $state(false)
  let confirmWipe = $state(false)
  let wiping = $state(false)

  async function refreshSnapshot() {
    try {
      const loaded = await loadSnapshot()
      snapshot = loaded
      snapshotValues = loaded ? Object.keys(parseBackup(loaded.contents).localStorage).length : 0
    } catch {
      // A snapshot that cannot be read is reported as absent rather than as an error: the next
      // automatic write replaces it, and there is nothing for the user to act on.
      snapshot = null
      snapshotValues = 0
    }
  }

  onMount(() => { if (native) void refreshSnapshot() })

  async function saveSnapshotNow() {
    snapshotBusy = true
    try {
      await saveSnapshot(localStorage)
      await refreshSnapshot()
      message = 'Snapshot saved.'
    } catch (error) {
      message = ioErrorMessage(error, 'Could not save the snapshot.')
    } finally {
      snapshotBusy = false
    }
  }

  async function restoreSnapshotNow() {
    snapshotBusy = true
    try {
      const loaded = await loadSnapshot()
      if (!loaded) { message = 'There is no snapshot to restore yet.'; return }
      const count = await restoreBackup(localStorage, parseBackup(loaded.contents))
      message = `Restored ${count} values from the snapshot. Restarting Izumi…`
      setTimeout(() => location.reload(), 350)
    } catch (error) {
      message = ioErrorMessage(error, 'Could not restore the snapshot.')
    } finally {
      snapshotBusy = false
    }
  }

  async function resetSettings() {
    if (!confirmWipe || wiping) return
    wiping = true
    try {
      const count = await wipePreferences(localStorage)
      message = `Cleared ${count} settings. Restarting Izumi…`
      setTimeout(() => location.reload(), 350)
    } catch (error) {
      message = ioErrorMessage(error, 'Could not reset settings.')
      wiping = false
    }
  }

  async function exportBackup() {
    try {
      const saved = await saveTextFile(
        `izumi-backup-${new Date().toISOString().slice(0, 10)}.json`,
        await stringifyBackup(localStorage, includeSecrets),
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

  async function applyRestore() {
    if (!pending) return
    try {
      const count = await restoreBackup(localStorage, pending)
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
  <p class="mb-6 max-w-2xl text-sm text-muted-foreground">Move the whole Izumi setup: interface and player settings, navigation, sources, downloads metadata, watch history, and resume positions.</p>

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
      <button data-focusable onclick={exportBackup} class="flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 font-bold text-primary-foreground sm:py-2">
        <Download size={16} /> Save backup
      </button>
    </section>

    <section class="rounded-xl border border-border p-4">
      <h3 class="font-black">Restore application backup</h3>
      <p class="mb-3 mt-1 text-xs text-muted-foreground">Imported values overwrite matching settings. Other values remain unchanged. Izumi reloads after a successful restore.</p>
      <button data-focusable onclick={() => fileInput?.click()} class="flex items-center gap-2 rounded-md bg-secondary px-4 py-2.5 font-bold active:bg-accent sm:py-2 sm:hover:bg-accent">
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
            <button data-focusable onclick={applyRestore} class="rounded-md bg-primary px-3 py-2.5 text-sm font-bold sm:py-2 text-primary-foreground">Restore and restart</button>
            <button data-focusable onclick={() => (pending = null)} class="rounded-md border border-border px-3 py-2.5 text-sm font-bold sm:py-2">Cancel</button>
          </div>
        </div>
      {/if}
    </section>
    {#if native}
      <section class="rounded-xl border border-border p-4">
        <h3 class="font-black">Automatic local snapshot</h3>
        <p class="mb-3 mt-1 text-xs text-muted-foreground">
          Settings normally live only in the app's web storage, which the system is allowed to clear on its own. Izumi keeps a plain JSON copy on disk and puts it back automatically if that ever happens. Account tokens and API keys are never written here, so you would sign in again; everything else returns. This file is also a normal backup — you can restore it above.
        </p>
        {#if snapshot}
          <div class="mb-3 rounded-md border border-border bg-secondary/40 p-3 text-xs">
            <div class="flex items-center gap-2 font-bold"><HardDrive size={14} /> {snapshotValues} values · {(snapshot.bytes / 1024).toFixed(1)} KB</div>
            {#if snapshot.savedAt}<div class="mt-1 text-muted-foreground">Last saved {new Date(snapshot.savedAt).toLocaleString()}</div>{/if}
            <div class="mt-1 break-all font-mono text-[11px] text-muted-foreground">{snapshot.path}</div>
          </div>
        {:else}
          <p class="mb-3 text-xs text-muted-foreground">No snapshot written yet.</p>
        {/if}
        <div class="flex flex-wrap gap-2">
          <button data-focusable disabled={snapshotBusy} onclick={saveSnapshotNow} class="rounded-md bg-secondary px-4 py-2.5 text-sm font-bold active:bg-accent disabled:opacity-60 sm:py-2 sm:hover:bg-accent">Save snapshot now</button>
          <button data-focusable disabled={snapshotBusy || !snapshot} onclick={restoreSnapshotNow} class="rounded-md border border-border px-4 py-2.5 text-sm font-bold disabled:opacity-60 sm:py-2">Restore from snapshot</button>
        </div>
      </section>

      <section class="rounded-xl border border-destructive/40 p-4">
        <h3 class="font-black">Reset all settings</h3>
        <p class="mb-3 mt-1 text-xs text-muted-foreground">
          Puts every preference back to its default: interface, player, sources, downloads, hotkeys and themes. Your watch history, library and sign-ins are kept. To erase everything instead, use <a href="/app/settings/about" data-focusable class="font-bold underline">Reset izumi to defaults</a> in About.
        </p>
        {#if confirmWipe}
          <div class="rounded-md border border-destructive/40 bg-destructive/5 p-4" aria-busy={wiping}>
            <p class="text-sm font-bold">Reset {preferenceKeysToWipe(localStorage).length} settings to defaults?</p>
            <p class="mt-2 text-xs leading-relaxed text-muted-foreground">This also deletes the local snapshot, so the settings cannot be recovered afterwards. Watch history, library and sign-ins are not touched.</p>
            <div class="mt-4 flex flex-wrap gap-2">
              <button data-focusable disabled={wiping} onclick={() => (confirmWipe = false)} class="rounded-md border border-border px-4 py-2.5 text-sm font-bold disabled:opacity-60 sm:py-2">Cancel</button>
              <button data-focusable disabled={wiping} onclick={resetSettings} class="rounded-md bg-destructive px-4 py-2.5 text-sm font-bold text-destructive-foreground disabled:opacity-60 active:bg-destructive/90 sm:py-2 sm:hover:bg-destructive/90">
                {wiping ? 'Resetting…' : 'Reset settings'}
              </button>
            </div>
          </div>
        {:else}
          <button data-focusable onclick={() => (confirmWipe = true)} class="flex items-center gap-2 rounded-md border border-destructive/40 px-4 py-2.5 text-sm font-bold text-destructive active:bg-destructive/10 sm:py-2 sm:hover:bg-destructive/10">
            <RotateCcw size={16} /> Reset all settings
          </button>
        {/if}
      </section>
    {/if}
    {#if message}<p class="text-sm text-theme">{message}</p>{/if}
  </div>
</div>
