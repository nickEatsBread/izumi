<script lang="ts">
  // Home and library › History: local saving, incognito, import and export, For You feedback and
  // the watched list, each a row of the subcategory card.
  import { saveLocalHistory } from '$lib/settings/ui'
  import { incognito, toggleIncognito } from '$lib/stores/incognito'
  import { localHistory, historyEntries, clearHistory, forgetMedia } from '$lib/player/history'
  import { exportJson, exportMalXml, importJson, ioErrorMessage, saveTextFile } from '$lib/player/history-io'
  import { title as mediaTitle } from '$lib/anilist/media'
  import { detailLink } from '$lib/anilist/detail-hint'
  import { dismissedForYouIds } from '$lib/recommendations/for-you'
  import SettingsRow from './SettingsRow.svelte'
  import SettingsSwitch from './SettingsSwitch.svelte'
  import Download from '@lucide/svelte/icons/download'
  import Upload from '@lucide/svelte/icons/upload'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import X from '@lucide/svelte/icons/x'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'

  const entries = $derived(historyEntries($localHistory))
  let msg = $state('')
  let confirmClear = $state(false)
  let fileInput = $state<HTMLInputElement>()

  // Films play without an episode number (recorded as their single episode), so the row shows
  // just the date rather than a meaningless "Episode 1".
  const isFilm = (entry: (typeof entries)[number]) => entry.media.catalog?.type === 'movie' || entry.media.format === 'MOVIE'

  const flash = (m: string) => { msg = m; setTimeout(() => { if (msg === m) msg = '' }, 4000) }
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  const toggleSaving = () => ($saveLocalHistory = !$saveLocalHistory)

  async function doExportJson() {
    try { if (await saveTextFile('izumi-watch-history.json', exportJson())) flash('Exported your history.') }
    catch (e) { flash(ioErrorMessage(e, 'Export failed.')) }
  }
  async function doExportXml() {
    const { xml, total, skipped } = exportMalXml()
    if (total === 0) return flash('Nothing to export yet.')
    try {
      if (await saveTextFile('izumi-watch-history.xml', xml)) {
        flash(skipped ? `Exported ${total - skipped} titles (${skipped} without a MyAnimeList id were skipped).` : `Exported ${total} titles.`)
      }
    }
    catch (e) { flash(ioErrorMessage(e, 'Export failed.')) }
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
  function resetForYou() {
    dismissedForYouIds.set([])
    flash('Recommendation feedback reset.')
  }
</script>

<SettingsRow
  settingKey="save-watch-history-on-this-device"
  title="Save watch history on this device"
  description="What you watch and how sources perform, kept on this device"
  learnMore="Continue Watching, resume and source selection improve from it locally. When the For You row is on, up to eight AniList title IDs are used to request suggestions; play times and progress stay on this device. Turning this off stops recording; existing data stays until you clear it."
  onActivate={toggleSaving}
  pressed={$saveLocalHistory}
>
  {#snippet control()}
    <SettingsSwitch value={$saveLocalHistory} onToggle={toggleSaving} label="Save watch history on this device" interactive={false} />
  {/snippet}
</SettingsRow>

<SettingsRow
  settingKey="incognito-mode"
  title="Incognito mode"
  description="Nothing synced to trackers or saved; resets on restart"
  learnMore="Nothing is pushed to AniList or MyAnimeList and nothing is saved to this device. Continue Watching still works, but only until you turn this off."
  onActivate={toggleIncognito}
  pressed={$incognito}
>
  {#snippet control()}
    <SettingsSwitch value={$incognito} onToggle={toggleIncognito} label="Incognito mode" interactive={false} />
  {/snippet}
</SettingsRow>

<SettingsRow
  settingKey="import-export-history"
  title="Import and export"
  description="Back up history or move it to another install"
  learnMore="The XML export imports into MyAnimeList and AniList directly, so it can also set up a tracker account."
>
  <div data-nav-line class="flex flex-wrap gap-2">
    <button data-focusable onclick={doExportJson} class="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-bold transition-colors active:bg-accent sm:py-2 sm:hover:bg-accent">
      <Download size={15} /> Export (izumi JSON)
    </button>
    <button data-focusable onclick={doExportXml} class="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-bold transition-colors active:bg-accent sm:py-2 sm:hover:bg-accent">
      <Download size={15} /> Export for MAL/AniList (XML)
    </button>
    <button data-focusable onclick={() => fileInput?.click()} class="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-bold transition-colors active:bg-accent sm:py-2 sm:hover:bg-accent">
      <Upload size={15} /> Import (izumi JSON)
    </button>
    <input bind:this={fileInput} onchange={onImportFile} type="file" accept="application/json,.json" class="hidden" />
  </div>
</SettingsRow>

{#if msg}<p role="status" class="px-3 py-2.5 text-sm text-theme">{msg}</p>{/if}

{#if $dismissedForYouIds.length}
  <SettingsRow
    title="For You feedback"
    description={`${$dismissedForYouIds.length} ${$dismissedForYouIds.length === 1 ? 'title is' : 'titles are'} marked “Not for me”`}
  >
    {#snippet control()}
      <button data-focusable onclick={resetForYou}
        class="flex shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-bold transition-colors active:bg-accent sm:hover:bg-accent">
        <RotateCcw size={14} /> Reset
      </button>
    {/snippet}
  </SettingsRow>
{/if}

<SettingsRow settingKey="watched-history" title="Watched titles" value={String(entries.length)}>
  {#snippet control()}
    {#if entries.length}
      <button data-focusable data-touch-target onclick={doClear}
        class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors sm:px-2.5 sm:py-1.5 {confirmClear ? 'bg-destructive text-white' : 'text-destructive active:bg-destructive/10 sm:hover:bg-destructive/10'}">
        <Trash2 size={14} /> {confirmClear ? 'Click again to clear all' : 'Clear all'}
      </button>
    {/if}
  {/snippet}
</SettingsRow>

{#if !entries.length}
  <p class="px-3 py-2.5 text-sm text-muted-foreground">Nothing watched yet — play an episode and it'll show up here.</p>
{:else}
  <ul class="divide-y divide-border/70">
    {#each entries as e (e.media.id)}
      <li class="flex items-center gap-3 px-3 py-2">
        {#if e.media.coverImage?.medium}
          <img src={e.media.coverImage.medium} alt="" loading="lazy" decoding="async" class="h-12 w-9 shrink-0 rounded object-cover" />
        {/if}
        <div class="min-w-0 flex-1">
          <a href={`/app/anime/${e.media.id}`} use:detailLink={e.media} data-focusable class="block truncate text-sm font-bold hover:text-theme">{mediaTitle(e.media)}</a>
          <p class="text-xs text-muted-foreground">{isFilm(e) ? fmt(e.updatedAt) : `Episode ${e.episode} · ${fmt(e.updatedAt)}`}</p>
        </div>
        <button data-focusable data-touch-target onclick={() => forgetMedia(e.media.id)} title="Remove" aria-label="Remove from history"
          class="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors active:bg-secondary active:text-destructive sm:size-8 sm:hover:bg-secondary sm:hover:text-destructive">
          <X size={16} />
        </button>
      </li>
    {/each}
  </ul>
{/if}
