<script lang="ts">
  import { addonUrls, normalizeBase } from '$lib/stremio/sources'
  import { anilistUser } from '$lib/anilist/account'
  import {
    anilistToken, anilistUserName,
    malToken, malUserName,
  } from '$lib/trackers/config'
  import {
    episodeLayout, autoSkip, preferredAudioLang, preferredSubLang,
    autoSelectSource, preferredQuality, type EpisodeLayout,
  } from '$lib/settings/ui'
  import { heroMedia } from '$lib/stores/hero'

  // No hero on this page — clear the shared banner so it doesn't persist.
  heroMedia.set(null)

  const layouts: { value: EpisodeLayout; label: string; hint: string }[] = [
    { value: 'cards', label: 'Cards', hint: 'Thumbnails, titles, ratings and a watch-progress bar.' },
    { value: 'compact', label: 'Compact', hint: 'Simple text rows — denser, lighter on data.' },
  ]
  let input = $state('')
  function add() { const b = normalizeBase(input); if (b) { $addonUrls = [...$addonUrls, b]; input = '' } }
  function remove(i: number) { $addonUrls = $addonUrls.filter((_, j) => j !== i) }

  let userInput = $state($anilistUser)
  function saveUser() { $anilistUser = userInput.trim() }
  function clearUser() { $anilistUser = ''; userInput = '' }

  // ----- Accounts (OAuth) -----
  let aniBusy = $state(false)
  let aniError = $state('')
  let malBusy = $state(false)
  let malError = $state('')

  async function connectAniListClick() {
    aniError = ''; aniBusy = true
    try {
      const { connectAniList } = await import('$lib/trackers/anilist-auth')
      await connectAniList()
    } catch (e) { aniError = e instanceof Error ? e.message : String(e) }
    finally { aniBusy = false }
  }
  async function disconnectAniListClick() {
    const { disconnectAniList } = await import('$lib/trackers/anilist-auth')
    disconnectAniList()
  }
  async function connectMalClick() {
    malError = ''; malBusy = true
    try {
      const { connectMal } = await import('$lib/trackers/mal-auth')
      await connectMal()
    } catch (e) { malError = e instanceof Error ? e.message : String(e) }
    finally { malBusy = false }
  }
  async function disconnectMalClick() {
    const { disconnectMal } = await import('$lib/trackers/mal-auth')
    disconnectMal()
  }
</script>
<div class="p-8">
  <h1 class="mb-4 text-2xl font-black">Settings</h1>
  <section class="mb-8 max-w-2xl">
    <h2 class="mb-1 text-lg font-black">Account</h2>
    <p class="mb-3 text-sm text-muted-foreground">Enter your AniList username to see your lists on Home (read-only; no login needed).</p>
    <div class="flex gap-2">
      <input bind:value={userInput} data-focusable placeholder="AniList username"
             class="flex-1 rounded-md bg-input px-3 py-2 text-sm" />
      <button onclick={saveUser} data-focusable class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">Save</button>
    </div>
    {#if $anilistUser}
      <div class="mt-3 flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
        <span class="truncate">Signed in as <span class="font-bold">{$anilistUser}</span></span>
        <button onclick={clearUser} data-focusable class="ml-2 text-destructive">Clear</button>
      </div>
    {:else}
      <p class="mt-3 text-sm text-muted-foreground">No username set.</p>
    {/if}
  </section>
  <section class="mb-8 max-w-2xl">
    <h2 class="mb-1 text-lg font-black">Accounts</h2>
    <p class="mb-3 text-sm text-muted-foreground">Connect AniList and/or MyAnimeList to push your watch progress. A login window opens in-app; sign in and it captures your access automatically.</p>

    <div class="mb-6 rounded-md border border-border p-4">
      <h3 class="mb-2 font-bold">AniList</h3>
      {#if $anilistToken && $anilistUserName}
        <div class="flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
          <span class="truncate">Connected as <span class="font-bold">{$anilistUserName}</span></span>
          <button onclick={disconnectAniListClick} data-focusable class="ml-2 text-destructive">Disconnect</button>
        </div>
      {:else}
        <button onclick={connectAniListClick} data-focusable disabled={aniBusy}
                class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50">
          {aniBusy ? 'Connecting…' : 'Connect'}
        </button>
      {/if}
      {#if aniError}<p class="mt-2 text-sm text-destructive">{aniError}</p>{/if}
    </div>

    <div class="rounded-md border border-border p-4">
      <h3 class="mb-2 font-bold">MyAnimeList</h3>
      {#if $malToken && $malUserName}
        <div class="flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
          <span class="truncate">Connected as <span class="font-bold">{$malUserName}</span></span>
          <button onclick={disconnectMalClick} data-focusable class="ml-2 text-destructive">Disconnect</button>
        </div>
      {:else}
        <button onclick={connectMalClick} data-focusable disabled={malBusy}
                class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50">
          {malBusy ? 'Connecting…' : 'Connect'}
        </button>
      {/if}
      {#if malError}<p class="mt-2 text-sm text-destructive">{malError}</p>{/if}
    </div>
  </section>
  <section class="mb-8 max-w-2xl">
    <h2 class="mb-1 text-lg font-black">Appearance</h2>
    <p class="mb-3 text-sm text-muted-foreground">Choose how the episode list is displayed on a title's detail page.</p>
    <div class="grid gap-2 sm:grid-cols-2">
      {#each layouts as opt (opt.value)}
        <button
          data-focusable
          onclick={() => ($episodeLayout = opt.value)}
          aria-pressed={$episodeLayout === opt.value}
          class="rounded-md border p-3 text-left transition-colors
            {$episodeLayout === opt.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}"
        >
          <div class="flex items-center justify-between">
            <span class="font-bold">{opt.label}</span>
            {#if $episodeLayout === opt.value}<span class="text-xs font-bold text-primary">Selected</span>{/if}
          </div>
          <p class="mt-1 text-xs text-muted-foreground">{opt.hint}</p>
        </button>
      {/each}
    </div>
  </section>
  <section class="mb-8 max-w-2xl">
    <h2 class="mb-1 text-lg font-black">Playback</h2>
    <p class="mb-3 text-sm text-muted-foreground">Languages, source selection, and openings/endings.</p>

    <!-- Preferred track languages (mpv auto-selects these) -->
    <div class="grid gap-3 sm:grid-cols-2">
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">Audio language</span>
        <select data-focusable bind:value={$preferredAudioLang} class="rounded-md bg-input px-3 py-2 text-sm">
          <option value="jpn">Japanese</option>
          <option value="eng">English</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">Subtitle language</span>
        <select data-focusable bind:value={$preferredSubLang} class="rounded-md bg-input px-3 py-2 text-sm">
          <option value="eng">English</option>
          <option value="jpn">Japanese</option>
          <option value="none">Off</option>
        </select>
      </label>
    </div>
    <p class="mt-1 text-xs text-muted-foreground">The player auto-selects these tracks when the file has them.</p>

    <!-- Auto-select source -->
    <button
      data-focusable
      onclick={() => ($autoSelectSource = !$autoSelectSource)}
      aria-pressed={$autoSelectSource}
      class="mt-4 flex w-full items-center justify-between rounded-md border border-border p-3 text-left transition-colors hover:bg-secondary"
    >
      <div>
        <div class="font-bold">Auto-select best source</div>
        <p class="mt-1 text-xs text-muted-foreground">Skip the source picker and play the best match for your preferred quality.</p>
      </div>
      <span class="relative ml-4 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors {$autoSelectSource ? 'bg-primary' : 'bg-input'}">
        <span class="inline-block h-5 w-5 transform rounded-full bg-white transition-transform {$autoSelectSource ? 'translate-x-5' : 'translate-x-0.5'}"></span>
      </span>
    </button>
    {#if $autoSelectSource}
      <label class="mt-3 flex flex-col gap-1">
        <span class="text-sm font-bold">Preferred quality</span>
        <select data-focusable bind:value={$preferredQuality} class="rounded-md bg-input px-3 py-2 text-sm">
          <option value="2160">4K</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
          <option value="480">480p</option>
          <option value="any">Any (highest available)</option>
        </select>
      </label>
    {/if}

    <!-- Auto-skip OP/ED -->
    <button
      data-focusable
      onclick={() => ($autoSkip = !$autoSkip)}
      aria-pressed={$autoSkip}
      class="mt-4 flex w-full items-center justify-between rounded-md border border-border p-3 text-left transition-colors hover:bg-secondary"
    >
      <div>
        <div class="font-bold">Auto-skip openings &amp; endings</div>
        <p class="mt-1 text-xs text-muted-foreground">Automatically skip OP/ED/recap segments (AniSkip). Off shows a manual Skip button instead.</p>
      </div>
      <span class="relative ml-4 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors {$autoSkip ? 'bg-primary' : 'bg-input'}">
        <span class="inline-block h-5 w-5 transform rounded-full bg-white transition-transform {$autoSkip ? 'translate-x-5' : 'translate-x-0.5'}"></span>
      </span>
    </button>
  </section>
  <section class="max-w-2xl">
    <h2 class="mb-1 text-lg font-black">Sources</h2>
    <p class="mb-3 text-sm text-muted-foreground">Paste a debrid-configured Stremio addon URL (e.g. your Torrentio Real-Debrid manifest link).</p>
    <div class="flex gap-2">
      <input bind:value={input} data-focusable placeholder="https://torrentio.strem.fun/realdebrid=.../manifest.json"
             class="flex-1 rounded-md bg-input px-3 py-2 text-sm" />
      <button onclick={add} data-focusable class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">Add</button>
    </div>
    <ul class="mt-3 space-y-2">
      {#each $addonUrls as url, i}
        <li class="flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
          <span class="truncate">{url}</span>
          <button onclick={() => remove(i)} data-focusable class="ml-2 text-destructive">Remove</button>
        </li>
      {/each}
      {#if !$addonUrls.length}<li class="text-sm text-muted-foreground">No sources yet.</li>{/if}
    </ul>
  </section>
</div>
