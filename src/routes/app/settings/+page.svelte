<script lang="ts">
  import { addonUrls, normalizeBase } from '$lib/stremio/sources'
  import { anilistUser } from '$lib/anilist/account'
  let input = $state('')
  function add() { const b = normalizeBase(input); if (b) { $addonUrls = [...$addonUrls, b]; input = '' } }
  function remove(i: number) { $addonUrls = $addonUrls.filter((_, j) => j !== i) }

  let userInput = $state($anilistUser)
  function saveUser() { $anilistUser = userInput.trim() }
  function clearUser() { $anilistUser = ''; userInput = '' }
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
