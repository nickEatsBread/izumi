<script lang="ts">
  import { addonUrls, normalizeBase } from '$lib/stremio/sources'
  import { anilistUser } from '$lib/anilist/account'
  import {
    anilistToken, anilistUserName,
    malToken, malUserName,
  } from '$lib/trackers/config'
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
