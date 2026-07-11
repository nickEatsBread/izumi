<script lang="ts">
  import { saveLocalHistory } from '$lib/settings/ui'
  import { localHistory, historyEntries, clearHistory, forgetMedia } from '$lib/player/history'
  import { exportJson, exportMalXml, importJson, saveTextFile } from '$lib/player/history-io'
  import { title as mediaTitle } from '$lib/anilist/media'
  import Toggle from '$lib/components/settings/Toggle.svelte'
  import Download from 'lucide-svelte/icons/download'
  import Upload from 'lucide-svelte/icons/upload'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import X from 'lucide-svelte/icons/x'

  const entries = $derived(historyEntries($localHistory))
  let msg = $state('')
  let confirmClear = $state(false)
  let fileInput = $state<HTMLInputElement>()

  const flash = (m: string) => { msg = m; setTimeout(() => { if (msg === m) msg = '' }, 4000) }
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

  async function doExportJson() {
    try { if (await saveTextFile('izumi-watch-history.json', exportJson())) flash('Exported your history.') }
    catch (e) { flash(e instanceof Error ? e.message : 'Export failed.') }
  }
  async function doExportXml() {
    const { xml, total, skipped } = exportMalXml()
    if (total === 0) return flash('Nothing to export yet.')
    try {
      if (await saveTextFile('izumi-watch-history.xml', xml)) {
        flash(skipped ? `Exported ${total - skipped} titles (${skipped} without a MyAnimeList id were skipped).` : `Exported ${total} titles.`)
      }
    }
    catch (e) { flash(e instanceof Error ? e.message : 'Export failed.') }
  }
  async function onImportFile(e: Event) {
    const el = e.target as HTMLInputElement
    const f = el.files?.[0]
    el.value = ''
    if (!f) return
    try { const { imported } = importJson(await f.text()); flash(`Imported ${imported} ${imported === 1 ? 'title' : 'titles'}.`) }
    catch (err) { flash(err instanceof Error ? err.message : 'Import failed — not a valid izumi export.') }
  }
  function doClear() {
    if (!confirmClear) { confirmClear = true; setTimeout(() => (confirmClear = false), 4000); return }
    clearHistory(); confirmClear = false; flash('History cleared.')
  }
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">History</h2>
  <p class="mb-4 max-w-2xl text-sm text-muted-foreground">
    izumi keeps your watch history and progress on this device, so Continue Watching and resume work
    even without an AniList or MyAnimeList account. It never leaves your machine unless you export it.
  </p>

  <div class="max-w-2xl space-y-6">
    <Toggle
      label="Save watch history on this device"
      desc="Record what you watch and how far you got, locally. Turn off to stop recording (existing history is kept until you clear it)."
      value={$saveLocalHistory}
      onToggle={() => ($saveLocalHistory = !$saveLocalHistory)}
    />

    <!-- Backup / move / seed a tracker -->
    <div class="rounded-xl border border-border p-4">
      <h3 class="text-sm font-black">Import &amp; export</h3>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Back up your history, move it to another install, or export it to set up an AniList/MyAnimeList
        account. The XML format imports into MyAnimeList and AniList directly.
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button data-focusable onclick={doExportJson} class="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
          <Download size={15} /> Export (izumi JSON)
        </button>
        <button data-focusable onclick={doExportXml} class="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
          <Download size={15} /> Export for MAL/AniList (XML)
        </button>
        <button data-focusable onclick={() => fileInput?.click()} class="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm font-bold transition-colors hover:bg-accent">
          <Upload size={15} /> Import (izumi JSON)
        </button>
        <input bind:this={fileInput} onchange={onImportFile} type="file" accept="application/json,.json" class="hidden" />
      </div>
      {#if msg}<p class="mt-3 text-sm text-theme">{msg}</p>{/if}
    </div>

    <!-- The stored list -->
    <div>
      <div class="mb-2 flex items-center justify-between">
        <h3 class="text-sm font-black">Watched ({entries.length})</h3>
        {#if entries.length}
          <button data-focusable onclick={doClear}
            class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors {confirmClear ? 'bg-destructive text-white' : 'text-destructive hover:bg-destructive/10'}">
            <Trash2 size={14} /> {confirmClear ? 'Click again to clear all' : 'Clear all'}
          </button>
        {/if}
      </div>
      {#if !entries.length}
        <p class="rounded-lg border border-border p-4 text-sm text-muted-foreground">Nothing watched yet — play an episode and it'll show up here.</p>
      {:else}
        <ul class="space-y-1.5">
          {#each entries as e (e.media.id)}
            <li class="flex items-center gap-3 rounded-lg border border-border p-2.5">
              {#if e.media.coverImage?.medium}
                <img src={e.media.coverImage.medium} alt="" class="h-12 w-9 shrink-0 rounded object-cover" />
              {/if}
              <div class="min-w-0 flex-1">
                <a href={`/app/anime/${e.media.id}`} data-focusable class="block truncate text-sm font-bold hover:text-theme">{mediaTitle(e.media)}</a>
                <p class="text-xs text-muted-foreground">Episode {e.episode} · {fmt(e.updatedAt)}</p>
              </div>
              <button data-focusable onclick={() => forgetMedia(e.media.id)} title="Remove" aria-label="Remove from history"
                class="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive">
                <X size={16} />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>
