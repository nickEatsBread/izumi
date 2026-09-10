<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import Check from '@lucide/svelte/icons/check'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import { m } from '$lib/paraglide/messages.js'
  import { connectedServices, type ConnectStates } from '$lib/onboarding/connect-state'
  import { plannedSyncTasks, sourcesLanded, syncSettled, syncSucceededAny, type NuvioExtras, type SyncTask, type SyncTaskId } from '$lib/onboarding/sync-receipt'
  import { resetStremioAddonSync, syncStremioAddons } from '$lib/stremio/account-sync'
  import { nuvioCloud } from '$lib/nuvio/cloud'
  import { nuvioSession } from '$lib/nuvio/auth'
  import { importCloudAddons, importCloudItems } from '$lib/nuvio/transfer'
  import { prepareNuvioImport } from '$lib/nuvio/api'
  import { installCollectionImport } from '$lib/catalog/collections/install'
  import { refreshAniListViewer } from '$lib/trackers/anilist-auth'
  import { refreshMalViewer } from '$lib/trackers/mal-auth'
  import { anilistUserName, malUserName } from '$lib/trackers/config'

  let {
    connections,
    nuvioExtras = $bindable(),
    busy = $bindable(),
    imported = $bindable(),
  }: { connections: ConnectStates; nuvioExtras: NuvioExtras; busy: boolean; imported: boolean } = $props()

  /** Setup always imports the primary Nuvio profile. Choosing between profiles stays on the Nuvio
   *  account screen in settings, which already handles PIN-protected ones. */
  const NUVIO_PROFILE = 1

  let started = $state(false)
  let tasks = $state<SyncTask[]>([])
  const abort = new AbortController()

  const services = $derived(connectedServices(connections))
  const settled = $derived(tasks.length > 0 && syncSettled(tasks))
  const nuvioChosen = $derived(services.includes('nuvio'))

  const label = (id: SyncTaskId) => ({
    'stremio': m.onboarding_task_stremio(),
    'nuvio-sources': m.onboarding_task_nuvio_sources(),
    'nuvio-collections': m.onboarding_task_nuvio_collections(),
    'nuvio-library': m.onboarding_task_nuvio_library(),
    'nuvio-progress': m.onboarding_task_nuvio_progress(),
    'nuvio-history': m.onboarding_task_nuvio_history(),
    'anilist': m.onboarding_task_anilist(),
    'mal': m.onboarding_task_mal(),
  })[id]

  onDestroy(() => abort.abort())
  onMount(() => {
    // Nothing to opt into unless Nuvio is connected, so a Stremio-only run starts immediately.
    if (!nuvioChosen) void run()
  })

  function setTask(id: SyncTaskId, state: SyncTask['state']) {
    tasks = tasks.map((task) => task.id === id ? { ...task, state } : task)
  }

  async function runTask(id: SyncTaskId): Promise<void> {
    setTask(id, { status: 'running' })
    try {
      const detail = await perform(id)
      if (abort.signal.aborted) return
      setTask(id, { status: 'done', detail })
      // The sources screen shows a review face only if real sources landed. Collections and
      // trackers do not count, which is why this asks the module rather than checking ids here.
      imported = sourcesLanded(tasks)
    } catch (cause) {
      if (abort.signal.aborted) return
      setTask(id, { status: 'failed', message: cause instanceof Error ? cause.message : m.onboarding_sync_failed() })
    }
  }

  async function perform(id: SyncTaskId): Promise<string> {
    if (id === 'stremio') {
      resetStremioAddonSync()
      const result = await syncStremioAddons()
      return m.onboarding_count_sources({ count: String(result.count) })
    }
    if (id === 'nuvio-sources') {
      const rows = await nuvioCloud.addons(NUVIO_PROFILE, abort.signal)
      const count = await importCloudAddons(rows.filter((row) => row.enabled !== false), abort.signal)
      return m.onboarding_count_sources({ count: String(count) })
    }
    if (id === 'nuvio-collections') {
      // Same chain the Nuvio account screen uses: pull the collections document, prepare one
      // collection at a time, install it without its required sources — those arrive as their own
      // task, so installing them here would double up.
      const stored = await nuvioCloud.blob('collections', NUVIO_PROFILE, 'izumi', abort.signal)
      const rows = Array.isArray(stored.value) ? stored.value : []
      let installed = 0
      for (const row of rows) {
        if (abort.signal.aborted) break
        const parsed = await prepareNuvioImport([row], `profile:${$nuvioSession?.userId}:${NUVIO_PROFILE}`)
        await installCollectionImport(parsed, [], abort.signal)
        installed += 1
      }
      return m.onboarding_count_collections({ count: String(installed) })
    }
    if (id === 'nuvio-library' || id === 'nuvio-progress' || id === 'nuvio-history') {
      const kind = id === 'nuvio-library' ? 'library' : id === 'nuvio-progress' ? 'progress' : 'history'
      const items = await nuvioCloud.snapshot(kind, NUVIO_PROFILE, abort.signal)
      const result = await importCloudItems(kind, items, abort.signal)
      return m.onboarding_count_items({ count: String(result.imported) })
    }
    if (id === 'anilist') {
      await refreshAniListViewer()
      return $anilistUserName || m.onboarding_connect_connected()
    }
    await refreshMalViewer()
    return $malUserName || m.onboarding_connect_connected()
  }

  async function run() {
    if (started) return
    started = true
    busy = true
    const planned = plannedSyncTasks(services, nuvioExtras)
    tasks = planned.map((id) => ({ id, state: { status: 'pending' } }))
    // Sequential on purpose: two of these write the same source list, and a user watching a
    // four-row list learns more from rows landing in order than from four spinners at once.
    // The finally matters: `busy` is bound to the shell's own, and leaving it true would disable
    // Back, Next and Skip for the rest of setup.
    try {
      for (const id of planned) {
        if (abort.signal.aborted) return
        await runTask(id)
      }
    } finally {
      if (!abort.signal.aborted) busy = false
    }
  }

  async function retry(id: SyncTaskId) {
    // The run loop is sequential on purpose because two of these write the same source list.
    // Firing a retry into the middle of it would race those writes and could also clear `busy`
    // out from under the loop, re-enabling the footer while a write is still in flight.
    if (busy) return
    busy = true
    await runTask(id)
    if (!abort.signal.aborted) busy = false
  }
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_sync_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_sync_body()}</p>

{#if !started && nuvioChosen}
  <h2 class="mt-7 text-base font-semibold">{m.onboarding_sync_extras_title()}</h2>
  <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{m.onboarding_sync_extras_body()}</p>
  <fieldset class="mt-4 grid gap-2">
    <legend class="sr-only">{m.onboarding_sync_extras_title()}</legend>
    {#each [{ key: 'library' as const, label: m.onboarding_sync_library() }, { key: 'progress' as const, label: m.onboarding_sync_progress() }, { key: 'history' as const, label: m.onboarding_sync_history() }] as extra}
      <label class="setup-choice flex cursor-pointer items-center gap-3 p-4 text-sm {nuvioExtras[extra.key] ? 'selected' : ''}">
        <input type="checkbox" data-focusable checked={nuvioExtras[extra.key]} onchange={(event) => nuvioExtras = { ...nuvioExtras, [extra.key]: event.currentTarget.checked }} />
        {extra.label}
      </label>
    {/each}
  </fieldset>
  <button type="button" data-focusable onclick={run} class="setup-inline-button mt-5 bg-foreground text-background">{m.onboarding_sync_start()}</button>
{:else}
  <ul class="mt-7 divide-y divide-border border-y border-border" role="status" aria-live="polite">
    {#each tasks as task (task.id)}
      <li class="flex flex-wrap items-center gap-3 py-4">
        {#if task.state.status === 'running'}<LoaderCircle size={19} class="tile-spinner shrink-0 text-muted-foreground" />
        {:else if task.state.status === 'done'}<Check size={19} class="shrink-0 text-muted-foreground" />
        {:else if task.state.status === 'failed'}<TriangleAlert size={19} class="shrink-0 text-destructive" />
        {:else}<span aria-hidden="true" class="size-[19px] shrink-0 rounded-full border border-border"></span>{/if}
        <span class="min-w-40 flex-1">
          <span class="block text-sm font-semibold">{label(task.id)}</span>
          <span class="mt-1 block text-xs text-muted-foreground">
            {#if task.state.status === 'done'}{task.state.detail}
            {:else if task.state.status === 'failed'}{task.state.message}
            {:else if task.state.status === 'running'}{m.onboarding_sync_running()}
            {:else}{m.onboarding_sync_pending()}{/if}
          </span>
        </span>
        {#if task.state.status === 'failed'}
          <button type="button" data-focusable onclick={() => retry(task.id)} disabled={busy} class="setup-inline-button bg-secondary px-3 text-sm"><RefreshCw size={14} />{m.onboarding_sync_retry()}</button>
        {/if}
      </li>
    {/each}
  </ul>
  {#if settled && !syncSucceededAny(tasks)}
    <p class="mt-5 text-sm leading-relaxed text-muted-foreground">{m.onboarding_sync_nothing()}</p>
  {/if}
{/if}
