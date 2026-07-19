<script lang="ts">
  import { anilistUser } from '$lib/anilist/account'
  import { anilistToken, anilistUserName, malToken, malUserName, malUser } from '$lib/trackers/config'

  // Read-only usernames (no login) — one per tracker. Public lists only; progress never syncs back.
  let aniInput = $state($anilistUser)
  function saveAni() { $anilistUser = aniInput.trim() }
  function clearAni() { $anilistUser = ''; aniInput = '' }
  let malInput = $state($malUser)
  function saveMal() { $malUser = malInput.trim() }
  function clearMal() { $malUser = ''; malInput = '' }

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

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Accounts</h2>
  <p class="mb-4 text-sm text-muted-foreground">Show a public AniList or MyAnimeList library without logging in, or connect an account to sync progress.</p>

  <section class="mb-8 max-w-2xl">
    <h3 class="mb-1 font-bold">Read-only (no login)</h3>
    <p class="mb-3 text-sm text-muted-foreground">Enter a public username to browse that library. Progress only syncs when you connect an account below.</p>

    <!-- AniList username -->
    <label for="ani-user" class="mb-1 block text-sm font-bold">AniList username</label>
    <div class="flex gap-2">
      <input id="ani-user" bind:value={aniInput} data-focusable placeholder="AniList username" class="flex-1 rounded-md bg-input px-3 py-2 text-sm" />
      <button onclick={saveAni} data-focusable class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">Save</button>
    </div>
    {#if $anilistUser}
      <div class="mt-2 flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
        <span class="truncate">Reading <span class="font-bold">{$anilistUser}</span>’s AniList</span>
        <button onclick={clearAni} data-focusable class="ml-2 text-destructive">Clear</button>
      </div>
    {/if}

    <!-- MyAnimeList username -->
    <label for="mal-user" class="mb-1 mt-4 block text-sm font-bold">MyAnimeList username</label>
    <div class="flex gap-2">
      <input id="mal-user" bind:value={malInput} data-focusable placeholder="MyAnimeList username" class="flex-1 rounded-md bg-input px-3 py-2 text-sm" />
      <button onclick={saveMal} data-focusable class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">Save</button>
    </div>
    {#if $malUser}
      <div class="mt-2 flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
        <span class="truncate">Reading <span class="font-bold">{$malUser}</span>’s MyAnimeList</span>
        <button onclick={clearMal} data-focusable class="ml-2 text-destructive">Clear</button>
      </div>
    {/if}
  </section>

  <section class="max-w-2xl">
    <h3 class="mb-2 font-bold">Connected trackers</h3>
    <p class="mb-3 text-sm text-muted-foreground">Sign in to push your watch progress. A login window opens in-app and captures your access automatically.</p>

    <div class="mb-6 rounded-md border border-border p-4">
      <h4 class="mb-2 font-bold">AniList</h4>
      {#if $anilistToken && $anilistUserName}
        <div class="flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
          <span class="truncate">Connected as <span class="font-bold">{$anilistUserName}</span></span>
          <button onclick={disconnectAniListClick} data-focusable class="ml-2 text-destructive">Disconnect</button>
        </div>
      {:else}
        <button onclick={connectAniListClick} data-focusable disabled={aniBusy} class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50">
          {aniBusy ? 'Connecting…' : 'Connect'}
        </button>
      {/if}
      {#if aniError}<p class="mt-2 text-sm text-destructive">{aniError}</p>{/if}
    </div>

    <div class="rounded-md border border-border p-4">
      <h4 class="mb-2 font-bold">MyAnimeList</h4>
      {#if $malToken && $malUserName}
        <div class="flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
          <span class="truncate">Connected as <span class="font-bold">{$malUserName}</span></span>
          <button onclick={disconnectMalClick} data-focusable class="ml-2 text-destructive">Disconnect</button>
        </div>
      {:else}
        <button onclick={connectMalClick} data-focusable disabled={malBusy} class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50">
          {malBusy ? 'Connecting…' : 'Connect'}
        </button>
      {/if}
      {#if malError}<p class="mt-2 text-sm text-destructive">{malError}</p>{/if}
    </div>
  </section>
</div>
