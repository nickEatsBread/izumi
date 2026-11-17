<script lang="ts">
  import { tick, type Component } from 'svelte'
  import { get } from 'svelte/store'
  import { downloads, speeds, pauseDownload, resumeDownload, cancelDownload, deleteDownload, revealDownload, clearFromList, diskSpace, type DiskSpace, type DownloadItem } from '$lib/downloads/store'
  import { downloadedMedia, getDownloadedMedia } from '$lib/downloads/state'
  import { playEpisode } from '$lib/stremio/play'
  import { fetchMediaById } from '$lib/anilist/fetch-media'
  import { heroMedia } from '$lib/stores/hero'
  import { formatBytes, formatSpeed } from '$lib/util/format'
  import { gameMode } from '$lib/player/session'
  import { controllerMode } from '$lib/nav/input'
  import { PAGE_OPTIONS_EVENT } from '$lib/nav/gamepad'
  import { focusWhenIdle } from '$lib/nav/initial-focus'
  import { themePresentation } from '$lib/themes/runtime'
  import OptionsSheet, { type SheetOption } from '$lib/components/detail/OptionsSheet.svelte'
  import ButtonHints from '$lib/components/shell/ButtonHints.svelte'
  import { bulkTargets, groupDownloads, lowOnSpace, neighbourOf, primaryActionOf, seriesTitle, sizeOnDisk, PRIMARY_LABEL, type PrimaryAction } from './group'
  import Search from '@lucide/svelte/icons/search'
  import Cloud from '@lucide/svelte/icons/cloud'
  import Play from '@lucide/svelte/icons/play'
  import Pause from '@lucide/svelte/icons/pause'
  import RotateCw from '@lucide/svelte/icons/rotate-cw'
  import Download from '@lucide/svelte/icons/download'
  import Clock from '@lucide/svelte/icons/clock'
  import X from '@lucide/svelte/icons/x'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import FolderOpen from '@lucide/svelte/icons/folder-open'
  import Ellipsis from '@lucide/svelte/icons/ellipsis'
  import ListChecks from '@lucide/svelte/icons/list-checks'
  import Eye from '@lucide/svelte/icons/eye'
  import Spinner from '$lib/components/Spinner.svelte'

  heroMedia.set(null)

  // A d-pad drives the page: big rows, one action on A, the rest in the options sheet. A mouse also
  // gets the secondary actions as buttons on the hovered row.
  const pad = $derived($gameMode || $controllerMode)
  const padNow = () => get(gameMode) || get(controllerMode)

  let filter = $state('')
  // Episodes taken off the list by Clear finished come back here to be played or deleted.
  let showCleared = $state(false)
  const all = $derived(Object.values($downloads))
  const groups = $derived(groupDownloads(all, filter, showCleared))
  const bulk = $derived(bulkTargets(all))
  const saved = $derived(all.filter((d) => d.status === 'done').length)
  const used = $derived(all.reduce((sum, d) => sum + sizeOnDisk(d), 0))
  const counts = $derived({
    downloading: all.filter((d) => d.status === 'downloading').length,
    queued: all.filter((d) => d.status === 'queued').length,
    failed: all.filter((d) => d.status === 'error').length,
  })

  // Free space on the downloads drive, read again when an episode finishes or leaves the list (a
  // string key, so progress ticks don't re-read it).
  let space = $state<DiskSpace | null>(null)
  const spaceKey = $derived(`${saved}:${all.length}`)
  $effect(() => {
    void spaceKey
    let live = true
    diskSpace().then((s) => { if (live) space = s })
    return () => { live = false }
  })

  const ICON: Record<PrimaryAction, Component<{ size?: number }>> = { play: Play, pause: Pause, resume: Download, retry: RotateCw, options: Clock }
  const pctOf = (d: DownloadItem) => (d.bytes ? Math.min(100, Math.round((d.downloaded / d.bytes) * 100)) : 0)
  const etaOf = (d: DownloadItem) => {
    const sp = $speeds[d.id]
    if (!sp || !d.bytes) return ''
    const s = Math.max(0, (d.bytes - d.downloaded) / sp)
    const m = Math.floor(s / 60)
    return m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m}m` : `${Math.round(s)}s`
  }
  const episodeTitle = (d: DownloadItem) => $downloadedMedia[d.mediaId]?.videos?.find((video) => video.number === d.episode)?.title

  // The episode a Play press is opening (its title may first be read online) or a Pause is stopping,
  // and why one could not open.
  let starting = $state<string | null>(null)
  let playErrors = $state<Record<string, string>>({})
  async function playLocal(d: DownloadItem) {
    starting = d.id
    const { [d.id]: _, ...rest } = playErrors
    playErrors = rest
    try {
      // Offline-first: use the cached series snapshot (no network); fall back online.
      const m = getDownloadedMedia(d.mediaId) ?? await fetchMediaById(d.mediaId)
      playEpisode(m, d.episode, () => {})
    } catch (err) {
      playErrors = { ...playErrors, [d.id]: `Couldn't open this episode: ${err instanceof Error ? err.message : String(err)}` }
    } finally {
      starting = null
    }
  }

  // A busy row stays enabled (WebKit drops controller focus from a disabled button): it is
  // aria-disabled and its press does nothing until the last one finished.
  async function primary(d: DownloadItem) {
    if (starting) return
    const action = primaryActionOf(d)
    if (action === 'play') return playLocal(d)
    if (action === 'options') { sheetFor = d.id; return }
    if (action === 'pause') {
      starting = d.id
      try { await pauseDownload(d.id) } finally { starting = null }
      return
    }
    resumeDownload(d.id)
  }

  // Deleting or cancelling takes the row away: focus goes on to the next row (else the one before,
  // else the empty state) instead of dropping to nothing under the d-pad.
  async function remove(d: DownloadItem, action: (id: string) => Promise<void>) {
    const next = neighbourOf(groups, d.id)
    await action(d.id)
    await tick()
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected && !active.closest('[inert]')) return
    const target = (next && document.querySelector<HTMLElement>(`[data-nav-id="download:${next}"]`))
      || document.querySelector<HTMLElement>('[data-part="downloads.empty"] [data-focusable]')
    target?.focus()
  }

  // Bulk actions at the top of the page, one episode at a time through the row's own pause, resume
  // and cancel. Like a busy row, a button with nothing to do stays focusable (aria-disabled + guard).
  let bulkBusy = $state(false)
  let confirmCancel = $state(false)
  async function runBulk(ids: string[], action: (id: string) => unknown) {
    if (bulkBusy || starting || !ids.length) return
    bulkBusy = true
    try { for (const id of ids) await action(id) } finally { bulkBusy = false }
  }
  const BULK = 'flex shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm font-bold outline-none hover:bg-accent focus-visible:bg-accent aria-disabled:opacity-40 aria-disabled:hover:bg-secondary'

  // The options sheet for one episode, opened by its More button or ☰ on its row.
  let sheetFor = $state<string | null>(null)
  const sheetItem = $derived(sheetFor ? $downloads[sheetFor] : undefined)
  const sheetOptions = $derived.by((): SheetOption[] => {
    const d = sheetItem
    if (!d) return []
    const action = primaryActionOf(d)
    return [
      ...(action === 'options' ? [] : [{ id: action, label: PRIMARY_LABEL[action], icon: ICON[action], onselect: () => primary(d) }]),
      ...(d.status === 'done' && !d.offlineUri ? [{ id: 'reveal', label: 'Show in folder', icon: FolderOpen, onselect: () => revealDownload(d.id) }] : []),
      d.status === 'done'
        ? { id: 'delete', label: 'Delete download', icon: Trash2, onselect: () => remove(d, deleteDownload) }
        : { id: 'cancel', label: 'Cancel download', icon: X, onselect: () => remove(d, cancelDownload) },
    ]
  })
  $effect(() => {
    const claim = (event: Event) => {
      // ☰ again closes the sheet, as on a title page.
      if (sheetFor) { event.preventDefault(); sheetFor = null; return }
      const id = document.activeElement?.closest<HTMLElement>('[data-download-id]')?.dataset.downloadId
      if (!id || document.querySelector('[data-nav-trap]')) return
      event.preventDefault()
      sheetFor = id
    }
    window.addEventListener(PAGE_OPTIONS_EVENT, claim)
    return () => window.removeEventListener(PAGE_OPTIONS_EVENT, claim)
  })
</script>

{#snippet row(d: DownloadItem, first: boolean)}
  {@const action = primaryActionOf(d)}
  {@const Icon = ICON[action]}
  {@const busy = starting === d.id}
  {@const name = episodeTitle(d)}
  <div data-part="downloads.item" data-state={d.status} data-download-id={d.id} class="group flex items-stretch gap-2">
    <button type="button" data-part="downloads.action" data-action={action} data-focusable data-nav-id={`download:${d.id}`}
            data-hint-a={PRIMARY_LABEL[action]} data-hint-start="Options" title={PRIMARY_LABEL[action]}
            aria-busy={busy} aria-disabled={busy || undefined} use:focusWhenIdle={first ? padNow : false}
            onclick={() => primary(d)}
            class="flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-4 rounded-xl bg-secondary/40 px-4 py-3 text-left outline-none hover:bg-secondary focus-visible:bg-secondary">
      <span class="grid size-11 shrink-0 place-items-center rounded-full {d.status === 'done' ? 'bg-primary text-primary-foreground' : d.status === 'error' ? 'bg-destructive/20 text-destructive' : 'bg-foreground/10'}">
        {#if busy}<Spinner size="md" inline />{:else}<Icon size={20} />{/if}
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2">
          <span class="truncate text-base font-bold">Episode {d.episode}{name ? ` · ${name}` : ''}</span>
          {#if d.quality}<span class="shrink-0 rounded bg-lime-500/15 px-1.5 text-[0.65rem] font-black text-lime-300">{d.quality}</span>{/if}
        </span>
        {#if d.status === 'downloading' || d.status === 'paused'}
          <span data-part="downloads.progress" class="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <span class="block h-full {d.status === 'paused' ? 'bg-amber-400' : 'bg-primary'} {$gameMode ? '' : 'transition-[width] duration-300 ease-out'}" style="width:{pctOf(d)}%"></span>
          </span>
          <span class="mt-1 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            {#if d.status === 'paused'}<span class="font-semibold text-amber-400">Paused</span>{/if}
            <span>{pctOf(d)}% · {formatBytes(d.downloaded) || '0 B'}{d.bytes ? ` / ${formatBytes(d.bytes)}` : ''}</span>
            {#if d.status === 'downloading' && $speeds[d.id]}<span>{formatSpeed($speeds[d.id])}</span>{#if d.bytes}<span>{etaOf(d)} left</span>{/if}{/if}
          </span>
        {:else if d.status === 'queued'}
          <span class="mt-0.5 block text-sm text-muted-foreground">Waiting to start</span>
        {:else if d.status === 'error'}
          <span class="mt-0.5 block truncate text-sm text-destructive" title={d.error}>{d.error ?? 'Download failed'}</span>
        {:else}
          <span class="mt-0.5 block text-sm text-muted-foreground">{formatBytes(d.bytes) || 'Saved'} · on this device</span>
          {#if playErrors[d.id]}<span role="alert" class="mt-0.5 block text-sm text-destructive">{playErrors[d.id]}</span>{/if}
        {/if}
      </span>
    </button>
    {#if !pad}
      <!-- Mouse shortcuts for what the sheet holds. No data-focusable: the d-pad goes straight to More. -->
      <div class="hidden shrink-0 items-center gap-1 group-hover:flex group-focus-within:flex">
        {#if d.status === 'done'}
          {#if !d.offlineUri}<button type="button" title="Show in folder" aria-label="Show in folder" onclick={() => revealDownload(d.id)} class="grid size-12 place-items-center rounded-xl hover:bg-accent"><FolderOpen size={18} /></button>{/if}
          <button type="button" title="Delete download" aria-label="Delete download" onclick={() => remove(d, deleteDownload)} class="grid size-12 place-items-center rounded-xl text-destructive hover:bg-accent"><Trash2 size={18} /></button>
        {:else}
          {#if action === 'pause' || action === 'resume'}
            <button type="button" data-part="downloads.toggle" title={PRIMARY_LABEL[action]} aria-label={`${PRIMARY_LABEL[action]} download`} aria-busy={busy} onclick={() => primary(d)} class="grid size-12 place-items-center rounded-xl hover:bg-accent"><Icon size={18} /></button>
          {/if}
          <button type="button" title="Cancel download" aria-label="Cancel download" onclick={() => remove(d, cancelDownload)} class="grid size-12 place-items-center rounded-xl hover:bg-accent"><X size={18} /></button>
        {/if}
      </div>
    {/if}
    <button type="button" data-part="downloads.more" data-focusable data-hint-start="Options" title="More options" aria-label="More options"
            aria-haspopup="dialog" onclick={() => (sheetFor = d.id)}
            class="grid w-14 shrink-0 place-items-center rounded-xl bg-secondary/40 outline-none hover:bg-secondary focus-visible:bg-secondary">
      <Ellipsis size={22} />
    </button>
  </div>
{/snippet}

<div data-slot="downloads" class="p-4 sm:p-8">
  <div data-part="downloads.header" class="mb-6 flex flex-wrap items-center justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-2xl font-black">Downloads</h1>
      <p class="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
        <span>{saved} saved · {formatBytes(used) || '0 B'} on this device</span>
        {#if space}<span class={lowOnSpace(space) ? 'text-amber-400' : ''} title={`${formatBytes(space.total)} drive`}>· {formatBytes(space.free)} free</span>{/if}
        {#if counts.downloading}<span>· {counts.downloading} downloading</span>{/if}
        {#if counts.queued}<span>· {counts.queued} queued</span>{/if}
        {#if counts.failed}<span class="text-destructive">· {counts.failed} failed</span>{/if}
      </p>
    </div>
    <div class="flex min-w-0 items-center gap-2">
      <a href="/app/cloud" data-focusable class="flex shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm font-bold"><Cloud size={16} /> Cloud</a>
      <label class="flex min-w-0 items-center gap-2 rounded-lg bg-secondary px-3 py-2">
        <Search size={15} class="shrink-0 text-muted-foreground" />
        <input bind:value={filter} data-focusable placeholder="Filter…" class="min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground sm:w-40" />
      </label>
    </div>
  </div>

  {#if all.length}
    <div data-part="downloads.bulk" class="mb-6 flex max-w-3xl flex-wrap items-center gap-2" aria-busy={bulkBusy}>
      <button type="button" data-focusable data-bulk="pause" aria-disabled={!bulk.pause.length || undefined}
              onclick={() => runBulk(bulk.pause, pauseDownload)} class={BULK}><Pause size={16} /> Pause all</button>
      <button type="button" data-focusable data-bulk="resume" aria-disabled={!bulk.resume.length || undefined}
              onclick={() => runBulk(bulk.resume, resumeDownload)} class={BULK}><Download size={16} /> Resume all</button>
      <button type="button" data-focusable data-bulk="cancel" aria-disabled={!bulk.cancel.length || undefined} aria-haspopup="dialog"
              onclick={() => { if (bulk.cancel.length && !bulkBusy) confirmCancel = true }} class={BULK}><X size={16} /> Cancel all pending</button>
      <button type="button" data-focusable data-bulk="clear" aria-disabled={!bulk.clear.length || undefined}
              onclick={() => { if (!bulkBusy) clearFromList(bulk.clear) }} class={BULK}><ListChecks size={16} /> Clear finished</button>
      {#if bulk.cleared}
        <button type="button" data-focusable data-bulk="show-cleared" aria-pressed={showCleared}
                onclick={() => (showCleared = !showCleared)} class="{BULK} {showCleared ? 'bg-accent' : ''}"><Eye size={16} /> Cleared ({bulk.cleared})</button>
      {/if}
    </div>
  {/if}

  {#if !groups.length}
    <div data-part="downloads.empty" class="mt-16 flex flex-col items-center gap-3 text-center">
      <Download size={40} class="text-muted-foreground" />
      <p class="text-lg font-bold">{filter.trim() ? 'Nothing matches that filter' : all.length ? 'Nothing on this list' : 'No downloads yet'}</p>
      <p class="text-sm text-muted-foreground">Use the download button on an episode to save it to this device.</p>
      <a href="/app/search" data-focusable use:focusWhenIdle={padNow} class="mt-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground">Find something to watch</a>
    </div>
  {:else}
    <div class="max-w-3xl space-y-8">
      {#each groups as group, g (group.mediaId)}
        <section data-part="downloads.series" data-media-id={group.mediaId}>
          <header class="mb-3 flex items-center gap-4">
            {#if group.poster}<img src={group.poster} alt="" loading="lazy" decoding="async" class="h-[4.5rem] w-12 shrink-0 rounded-lg object-cover" />{:else}<div class="h-[4.5rem] w-12 shrink-0 rounded-lg bg-muted"></div>{/if}
            <div class="min-w-0">
              <h2 class="truncate text-lg font-black">{group.title}</h2>
              <p class="text-sm text-muted-foreground">{group.items.length} {group.items.length === 1 ? 'episode' : 'episodes'} · {formatBytes(group.bytes) || '0 B'}</p>
            </div>
          </header>
          <div class="space-y-2">
            {#each group.items as d, i (d.id)}{@render row(d, g === 0 && i === 0)}{/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

{#if sheetItem}
  <OptionsSheet title={`Episode ${sheetItem.episode}`} subtitle={seriesTitle(sheetItem)}
                groups={[{ options: sheetOptions }]} onclose={() => (sheetFor = null)} />
{/if}
{#if confirmCancel}
  <!-- Cancelling deletes what each episode has downloaded so far, so it is asked first. -->
  <OptionsSheet title={`Cancel ${bulk.cancel.length} ${bulk.cancel.length === 1 ? 'download' : 'downloads'}?`}
                subtitle="What they have downloaded so far is deleted."
                groups={[{ options: [
                  { id: 'cancel-all', label: 'Cancel downloads', icon: X, onselect: () => runBulk(bulk.cancel, cancelDownload) },
                  { id: 'keep', label: 'Keep them', icon: Download, onselect: () => {} },
                ] }]}
                onclose={() => (confirmCancel = false)} />
{/if}
{#if $gameMode && !$themePresentation?.shell?.hints}<ButtonHints />{/if}
