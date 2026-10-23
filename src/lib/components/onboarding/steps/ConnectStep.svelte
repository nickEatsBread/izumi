<script lang="ts">
  import { onDestroy } from 'svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right'
  import Check from '@lucide/svelte/icons/check'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import { m } from '$lib/paraglide/messages.js'
  import ConnectTile from './ConnectTile.svelte'
  import TrackerTiles from './TrackerTiles.svelte'
  import { CONNECT_SERVICES, tileBusy, type ConnectService, type ConnectStates } from '$lib/onboarding/connect-state'
  import { plannedSyncTasks, sourcesLanded, tasksFor, type NuvioExtras, type SyncTask, type SyncTaskId } from '$lib/onboarding/sync-receipt'
  import { connectStremio, connectStremioWithAuthKey, stremioAccountEmail, stremioAuthKey } from '$lib/stremio/account'
  import { createStremioLink, pollStremioLink } from '$lib/stremio/link'
  import { resetStremioAddonSync, syncStremioAddons } from '$lib/stremio/account-sync'
  import { nuvioClient, nuvioSession } from '$lib/nuvio/auth'
  import { nuvioCloud } from '$lib/nuvio/cloud'
  import { importCloudAddons, importCloudItems } from '$lib/nuvio/transfer'
  import { prepareNuvioImport } from '$lib/nuvio/api'
  import { installCollectionImport } from '$lib/catalog/collections/install'

  let {
    connections = $bindable(),
    busy = $bindable(),
    nuvioExtras = $bindable({ library: false, progress: false, history: false }),
    imported = $bindable(false),
  }: { connections: ConnectStates; busy: boolean; nuvioExtras?: NuvioExtras; imported?: boolean } = $props()

  /** Setup always imports the primary Nuvio profile. Choosing between profiles stays on the Nuvio
   *  account screen in settings, which already handles PIN-protected ones. */
  const NUVIO_PROFILE = 1

  let open = $state<ConnectService | null>(null)
  let stremioMode = $state<'code' | 'password'>('code')
  let email = $state('')
  let password = $state('')
  let nuvioMode = $state<'device' | 'password'>('device')
  let nuvioEmail = $state('')
  let nuvioPassword = $state('')
  let tasks = $state<SyncTask[]>([])
  /** Deliberately not $state: it only stops a second drain loop from starting, it is never rendered. */
  let draining = false
  // One controller per tile: two tiles can each be mid-approval, and starting a flow in one must
  // never silently kill the other's poll while its code is still on screen.
  const controllers: Partial<Record<ConnectService, AbortController>> = {}
  const importAbort = new AbortController()

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

  // The footer stays disabled while a tile waits on an approval or an import is still writing, so
  // neither can be navigated away from half-finished.
  $effect(() => {
    busy = CONNECT_SERVICES.some((service) => tileBusy(connections[service]))
      || tasks.some((task) => task.state.status === 'pending' || task.state.status === 'running')
  })

  // Reflect source accounts that were already connected before setup ran, so a re-run does not
  // offer to connect something that is already live. TrackerTiles does the same for trackers.
  $effect(() => {
    if ($stremioAuthKey && connections.stremio.status !== 'connected') connections = { ...connections, stremio: { status: 'connected', identity: $stremioAccountEmail } }
    if ($nuvioSession && connections.nuvio.status !== 'connected') connections = { ...connections, nuvio: { status: 'connected', identity: $nuvioSession.email } }
  })

  onDestroy(() => {
    importAbort.abort()
    for (const controller of Object.values(controllers)) controller?.abort()
  })

  function begin(service: ConnectService) {
    controllers[service]?.abort()
    return controllers[service] = new AbortController()
  }

  /** A pending code counts as busy, which disables the footer. Without this the user is pinned to
   *  this screen until the poll gives up — minutes later. Abandoning the code must always be possible. */
  function cancel(service: ConnectService) {
    controllers[service]?.abort()
    controllers[service] = undefined
    set(service, { status: 'idle' })
  }

  function set(service: ConnectService, state: ConnectStates[ConnectService]) {
    connections = { ...connections, [service]: state }
  }

  function expand(service: ConnectService) {
    open = open === service ? null : service
  }

  const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback

  /** Called when a source account finishes signing in: what it holds comes over straight away, so
   *  there is no separate import screen to wait on. */
  function enqueue(service: 'stremio' | 'nuvio') {
    const fresh = plannedSyncTasks([service], nuvioExtras).filter((id) => !tasks.some((task) => task.id === id))
    tasks = [...tasks, ...fresh.map((id): SyncTask => ({ id, state: { status: 'pending' } }))]
    void drain()
  }

  const nextPending = () => tasks.find((task) => task.state.status === 'pending')

  /** One task at a time: Stremio and Nuvio both write the same source list, and parallel writes
   *  would race each other. A retry or a second sign-in joins the loop already running. */
  async function drain() {
    if (draining) return
    draining = true
    try {
      for (let next = nextPending(); next && !importAbort.signal.aborted; next = nextPending()) await runTask(next.id)
    } finally {
      draining = false
    }
  }

  function setTask(id: SyncTaskId, state: SyncTask['state']) {
    tasks = tasks.map((task) => task.id === id ? { ...task, state } : task)
  }

  async function runTask(id: SyncTaskId): Promise<void> {
    setTask(id, { status: 'running' })
    try {
      const detail = await perform(id)
      if (importAbort.signal.aborted) return
      setTask(id, { status: 'done', detail })
      // The sources screen shows a review face only if real sources landed. Collections do not
      // count, which is why this asks the module rather than checking ids here.
      imported = sourcesLanded(tasks)
    } catch (cause) {
      if (importAbort.signal.aborted) return
      setTask(id, { status: 'failed', message: message(cause, m.onboarding_sync_failed()) })
    }
  }

  async function perform(id: SyncTaskId): Promise<string> {
    if (id === 'stremio') {
      resetStremioAddonSync()
      const result = await syncStremioAddons()
      return m.onboarding_count_sources({ count: String(result.count) })
    }
    if (id === 'nuvio-sources') {
      const rows = await nuvioCloud.addons(NUVIO_PROFILE, importAbort.signal)
      const count = await importCloudAddons(rows.filter((row) => row.enabled !== false), importAbort.signal)
      return m.onboarding_count_sources({ count: String(count) })
    }
    if (id === 'nuvio-collections') {
      // Same chain the Nuvio account screen uses: pull the collections document, prepare one
      // collection at a time, install it without its required sources — those arrive as their own
      // task, so installing them here would double up.
      const stored = await nuvioCloud.blob('collections', NUVIO_PROFILE, 'izumi', importAbort.signal)
      const rows = Array.isArray(stored.value) ? stored.value : []
      let installed = 0
      for (const row of rows) {
        if (importAbort.signal.aborted) break
        const parsed = await prepareNuvioImport([row], `profile:${$nuvioSession?.userId}:${NUVIO_PROFILE}`)
        await installCollectionImport(parsed, [], importAbort.signal)
        installed += 1
      }
      return m.onboarding_count_collections({ count: String(installed) })
    }
    if (id === 'nuvio-library' || id === 'nuvio-progress' || id === 'nuvio-history') {
      const kind = id === 'nuvio-library' ? 'library' : id === 'nuvio-progress' ? 'progress' : 'history'
      const items = await nuvioCloud.snapshot(kind, NUVIO_PROFILE, importAbort.signal)
      const result = await importCloudItems(kind, items, importAbort.signal)
      return m.onboarding_count_items({ count: String(result.imported) })
    }
    // Trackers are never queued here: their lists are read live, so there is nothing to import.
    throw new Error(m.onboarding_sync_failed())
  }

  function retry(id: SyncTaskId) {
    setTask(id, { status: 'pending' })
    void drain()
  }

  async function signInStremio(event: SubmitEvent) {
    event.preventDefault()
    if (tileBusy(connections.stremio)) return
    const submitted = password
    password = ''
    set('stremio', { status: 'busy' })
    try {
      await connectStremio(email, submitted)
      set('stremio', { status: 'connected', identity: email.trim() })
      open = null
      enqueue('stremio')
    } catch (cause) {
      set('stremio', { status: 'error', message: message(cause, m.onboarding_stremio_sync_error()) })
    }
  }

  /** Stremio's own link codes: the user approves on link.stremio.com and izumi is handed a session
   *  key, so no password is ever typed here. */
  async function connectStremioLink() {
    if (tileBusy(connections.stremio)) return
    const abort = begin('stremio')
    set('stremio', { status: 'busy' })
    try {
      const link = await createStremioLink(abort.signal)
      const showCode = (completing: boolean) => set('stremio', { status: 'code', code: link.code, url: link.url, completing })
      showCode(false)
      const authKey = await pollStremioLink(link.code, (status) => showCode(status === 'approved'), abort.signal)
      set('stremio', { status: 'connected', identity: await connectStremioWithAuthKey(authKey) })
      open = null
      enqueue('stremio')
    } catch (cause) {
      if (abort.signal.aborted) return
      set('stremio', { status: 'error', message: message(cause, m.onboarding_connect_failed()) })
    }
  }

  async function connectNuvioDevice() {
    if (tileBusy(connections.nuvio)) return
    const abort = begin('nuvio')
    set('nuvio', { status: 'busy' })
    try {
      await nuvioClient.connectDevice((code) => set('nuvio', { status: 'code', code: code.code, url: code.url, completing: code.completing }), abort.signal)
      set('nuvio', { status: 'connected', identity: $nuvioSession?.email ?? '' })
      open = null
      enqueue('nuvio')
    } catch (cause) {
      if (abort.signal.aborted) return
      set('nuvio', { status: 'error', message: message(cause, m.onboarding_connect_failed()) })
    }
  }

  async function signInNuvio(event: SubmitEvent) {
    event.preventDefault()
    if (tileBusy(connections.nuvio)) return
    const submitted = nuvioPassword
    nuvioPassword = ''
    const abort = begin('nuvio')
    set('nuvio', { status: 'busy' })
    try {
      await nuvioClient.signIn(nuvioEmail, submitted, abort.signal)
      set('nuvio', { status: 'connected', identity: nuvioEmail.trim() })
      open = null
      enqueue('nuvio')
    } catch (cause) {
      if (abort.signal.aborted) return
      set('nuvio', { status: 'error', message: message(cause, m.onboarding_connect_failed()) })
    }
  }

  async function visit(url: string) {
    try { await openUrl(url) } catch { window.open(url, '_blank', 'noopener,noreferrer') }
  }
</script>

{#snippet importRows(service: ConnectService)}
  {#if tasksFor(tasks, service).length}
    <ul class="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 border-t border-border pt-3" role="status" aria-live="polite">
      {#each tasksFor(tasks, service) as task (task.id)}
        <li class="flex min-w-0 items-center gap-2 text-xs">
          {#if task.state.status === 'done'}<Check size={14} class="shrink-0 text-muted-foreground" />
          {:else if task.state.status === 'failed'}<TriangleAlert size={14} class="shrink-0 text-destructive" />
          {:else}<LoaderCircle size={14} class="tile-spinner shrink-0 text-muted-foreground" />{/if}
          <span class="min-w-0 flex-1 truncate">
            <span class="font-semibold">{label(task.id)}</span>
            <span class="text-muted-foreground"> · {task.state.status === 'done' ? task.state.detail : task.state.status === 'failed' ? task.state.message : task.state.status === 'running' ? m.onboarding_sync_running() : m.onboarding_sync_pending()}</span>
          </span>
          {#if task.state.status === 'failed'}
            <button type="button" data-focusable onclick={() => retry(task.id)} class="setup-inline-button min-h-8 shrink-0 bg-secondary px-2 text-xs"><RefreshCw size={12} />{m.onboarding_sync_retry()}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_connect_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_connect_body()}</p>

<!-- Official marks, bundled so a tile never depends on an external image request — the same
     approach the AniList, MyAnimeList and Trakt marks in static/brand/ already take.
     stremio.png from www.stremio.com; nuvio.png from nuvio.tv, downscaled for the tile.
     Each tile falls back to a lettered square if its image ever fails to load. -->
<h2 class="mt-7 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.onboarding_connect_sources_group()}</h2>
<!-- items-start: side by side, an expanded tile must not stretch its neighbour to match. -->
<div class="mt-3 grid grid-cols-[minmax(0,1fr)] items-start gap-2 lg:grid-cols-2">
  <ConnectTile name="Stremio" logo="/brand/stremio.png" initial="S" description={m.onboarding_connect_stremio_body()} state={connections.stremio} expanded={open === 'stremio'} onexpand={() => expand('stremio')}>
    {#snippet panel()}
      {#if connections.stremio.status === 'code'}
        <p class="text-sm font-semibold">{m.onboarding_stremio_code_title()}</p>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{m.onboarding_stremio_code_body()}</p>
        <p aria-label={m.onboarding_stremio_code_label({ code: connections.stremio.code })} class="my-4 rounded-xl border border-border bg-background py-4 text-center font-mono text-2xl font-bold tracking-[0.15em]">{connections.stremio.code}</p>
        <button type="button" data-focusable onclick={() => visit(connections.stremio.status === 'code' ? connections.stremio.url : '')} class="setup-inline-button w-full bg-foreground text-background">{m.onboarding_stremio_open()}<ArrowUpRight size={15} /></button>
        <p role="status" class="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={15} class="tile-spinner" />{connections.stremio.completing ? m.onboarding_stremio_completing() : m.onboarding_stremio_waiting()}</p>
        <button type="button" data-focusable onclick={() => cancel('stremio')} class="mt-3 min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_stremio_cancel()}</button>
      {:else if stremioMode === 'code'}
        <button type="button" data-focusable onclick={connectStremioLink} class="setup-inline-button w-full bg-foreground text-background">{m.onboarding_stremio_connect()}</button>
        <p class="mt-3 text-center text-xs leading-relaxed text-muted-foreground">{m.onboarding_stremio_link_hint()}</p>
        <button type="button" data-focusable onclick={() => stremioMode = 'password'} class="mt-2 min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_stremio_password_instead()}</button>
      {:else}
        <form onsubmit={signInStremio} class="grid gap-3">
          <label class="grid gap-2 text-sm font-semibold" for="connect-stremio-email">{m.onboarding_stremio_email()}
            <input id="connect-stremio-email" data-focusable bind:value={email} type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" required class="setup-field" /></label>
          <label class="grid gap-2 text-sm font-semibold" for="connect-stremio-password">{m.onboarding_stremio_password()}
            <input id="connect-stremio-password" data-focusable bind:value={password} type="password" autocomplete="current-password" required class="setup-field" /></label>
          <p class="text-xs leading-relaxed text-muted-foreground">{m.onboarding_stremio_credentials_hint()}</p>
          <button type="submit" data-focusable class="setup-inline-button bg-foreground text-background" disabled={!email.trim() || !password}>{m.onboarding_stremio_sign_in()}</button>
          <button type="button" data-focusable onclick={() => stremioMode = 'code'} class="min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_stremio_code_instead()}</button>
        </form>
      {/if}
    {/snippet}
    {#snippet footer()}{@render importRows('stremio')}{/snippet}
  </ConnectTile>

  <ConnectTile name="Nuvio" logo="/brand/nuvio.png" initial="N" description={m.onboarding_connect_nuvio_body()} state={connections.nuvio} expanded={open === 'nuvio'} onexpand={() => expand('nuvio')}>
    {#snippet panel()}
      {#if connections.nuvio.status === 'code'}
        <p class="text-sm font-semibold">{m.onboarding_nuvio_code_title()}</p>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{m.onboarding_nuvio_code_body()}</p>
        <p aria-label={m.onboarding_nuvio_code_label({ code: connections.nuvio.code })} class="my-4 rounded-xl border border-border bg-background py-4 text-center font-mono text-2xl font-bold tracking-[0.15em]">{connections.nuvio.code}</p>
        <button type="button" data-focusable onclick={() => visit(connections.nuvio.status === 'code' ? connections.nuvio.url : '')} class="setup-inline-button w-full bg-foreground text-background">{m.onboarding_nuvio_open()}<ArrowUpRight size={15} /></button>
        <p role="status" class="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={15} class="tile-spinner" />{connections.nuvio.completing ? m.onboarding_nuvio_completing() : m.onboarding_nuvio_waiting()}</p>
        <button type="button" data-focusable onclick={() => cancel('nuvio')} class="mt-3 min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_nuvio_cancel()}</button>
      {:else}
        <!-- Asked before signing in, because the import starts the moment the account connects.
             These write watch state, so every box starts off. -->
        <fieldset class="mb-4">
          <legend class="text-sm font-semibold">{m.onboarding_sync_extras_title()}</legend>
          <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{m.onboarding_sync_extras_body()}</p>
          <div class="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {#each [{ key: 'library' as const, label: m.onboarding_sync_library() }, { key: 'progress' as const, label: m.onboarding_sync_progress() }, { key: 'history' as const, label: m.onboarding_sync_history() }] as extra}
              <label class="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" data-focusable checked={nuvioExtras[extra.key]} onchange={(event) => nuvioExtras = { ...nuvioExtras, [extra.key]: event.currentTarget.checked }} />
                {extra.label}
              </label>
            {/each}
          </div>
        </fieldset>
        {#if nuvioMode === 'device'}
          <button type="button" data-focusable onclick={connectNuvioDevice} class="setup-inline-button w-full bg-foreground text-background">{m.onboarding_nuvio_connect()}</button>
          <p class="mt-3 text-center text-xs leading-relaxed text-muted-foreground">{m.onboarding_nuvio_device_hint()}</p>
          <button type="button" data-focusable onclick={() => nuvioMode = 'password'} class="mt-2 min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_nuvio_password_instead()}</button>
        {:else}
          <form onsubmit={signInNuvio} class="grid gap-3">
            <label class="grid gap-2 text-sm font-semibold" for="connect-nuvio-email">{m.onboarding_stremio_email()}
              <input id="connect-nuvio-email" data-focusable bind:value={nuvioEmail} type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" required class="setup-field" /></label>
            <label class="grid gap-2 text-sm font-semibold" for="connect-nuvio-password">{m.onboarding_stremio_password()}
              <input id="connect-nuvio-password" data-focusable bind:value={nuvioPassword} type="password" autocomplete="current-password" required class="setup-field" /></label>
            <button type="submit" data-focusable class="setup-inline-button bg-foreground text-background" disabled={!nuvioEmail.trim() || !nuvioPassword}>{m.onboarding_stremio_sign_in()}</button>
            <button type="button" data-focusable onclick={() => nuvioMode = 'device'} class="min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_nuvio_code_instead()}</button>
          </form>
        {/if}
      {/if}
    {/snippet}
    {#snippet footer()}{@render importRows('nuvio')}{/snippet}
  </ConnectTile>
</div>

<h2 class="mt-7 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.onboarding_connect_list_group()}</h2>
<TrackerTiles bind:connections />

<p class="mt-6 text-xs leading-relaxed text-muted-foreground">{m.onboarding_connect_later_hint()}</p>
