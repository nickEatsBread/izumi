<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener'
  import Film from '@lucide/svelte/icons/film'
  import Rss from '@lucide/svelte/icons/rss'
  import SettingsGroup from './SettingsGroup.svelte'
  import SettingsRow from './SettingsRow.svelte'
  import { letterboxdFeedCache, letterboxdFeedUpdatedAt, letterboxdUsername } from '$lib/letterboxd/config'
  import { validLetterboxdUsername } from '$lib/letterboxd/feed'

  let formOpen = $state(false)
  let usernameInput = $state($letterboxdUsername)
  let error = $state('')

  function save() {
    const username = usernameInput.trim()
    if (!validLetterboxdUsername(username)) {
      error = 'Use 2–15 letters, numbers, or underscores.'
      return
    }
    if ($letterboxdUsername !== username) {
      $letterboxdFeedCache = []
      $letterboxdFeedUpdatedAt = 0
    }
    $letterboxdUsername = username
    error = ''
    formOpen = false
  }

  function clear() {
    $letterboxdUsername = ''
    $letterboxdFeedCache = []
    $letterboxdFeedUpdatedAt = 0
    usernameInput = ''
    error = ''
    formOpen = false
  }
</script>

{#snippet leading()}
  <span class="relative grid size-10 shrink-0 place-items-center rounded-xl bg-[#202830]" aria-hidden="true">
    <span class="flex gap-0.5"><i class="size-2 rounded-full bg-[#00e054]"></i><i class="size-2 rounded-full bg-[#40bcf4]"></i><i class="size-2 rounded-full bg-[#ff8000]"></i></span>
  </span>
{/snippet}
{#snippet meta()}
  <span class="inline-flex min-w-0 items-center gap-1.5">
    <span class="size-1.5 shrink-0 rounded-full {$letterboxdUsername ? 'bg-emerald-400' : 'bg-white/25'}"></span>
    <span class="truncate">{$letterboxdUsername ? `Public diary connected as ${$letterboxdUsername}` : 'Not set · RSS and export import'}</span>
  </span>
{/snippet}
{#snippet control()}
  <button type="button" data-focusable aria-expanded={formOpen} data-touch-target onclick={() => (formOpen = !formOpen)} class="min-h-8 rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent">{formOpen ? 'Close' : $letterboxdUsername ? 'Manage' : 'Set up'}</button>
{/snippet}

<SettingsGroup
  icon={Film}
  title="Letterboxd"
  desc="A supported public-diary and data-export experience; no scraping or unofficial sign-in."
>
  <SettingsRow settingKey="letterboxd-account" title="Letterboxd profile" leading={leading} meta={meta} control={control} expanded={formOpen || Boolean(error)}>
    <div class="flex flex-col gap-2 sm:flex-row">
      <label class="sr-only" for="letterboxd-username">Letterboxd username</label>
      <input id="letterboxd-username" bind:value={usernameInput} autocomplete="username" data-focusable placeholder="Letterboxd username" class="h-10 min-w-0 flex-1 rounded-md bg-input px-3 text-base sm:text-sm" onkeydown={(event) => event.key === 'Enter' && save()} />
      <button type="button" data-focusable data-touch-target onclick={save} class="min-h-10 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground">Save</button>
      {#if $letterboxdUsername}<button type="button" data-focusable data-touch-target onclick={clear} class="min-h-10 rounded-md px-3 text-sm font-bold text-destructive hover:bg-destructive/10">Clear</button>{/if}
    </div>
    <div class="mt-3 flex flex-col gap-2 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span class="inline-flex items-center gap-1.5"><Rss size={13} />Izumi reads Letterboxd’s official per-profile RSS feed. Import the official export ZIP in the hub for older history and Watchlist.</span>
      <div class="flex shrink-0 gap-2">
        <button type="button" data-focusable data-touch-target onclick={() => openUrl('https://letterboxd.com/user/exportdata/')} class="min-h-9 rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent">Export data</button>
        <a data-touch-target href="/app/letterboxd" data-focusable class="inline-flex min-h-9 items-center rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent">Open hub</a>
      </div>
    </div>
    {#if error}<p role="alert" class="mt-2 text-xs text-destructive">{error}</p>{/if}
  </SettingsRow>
</SettingsGroup>
