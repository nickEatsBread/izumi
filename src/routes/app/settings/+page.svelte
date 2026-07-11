<script lang="ts">
  import {
    autoSkip, skipFiller, preferredAudioLang, preferredSubLang,
    autoplayNext, bingePreload, seekDuration, enableExternalPlayer, externalPlayerPath,
    scrubThumbnails, titleLanguage, playerTitleTop, playerCacheMb, CACHE_UNCAPPED,
  } from '$lib/settings/ui'
  import Toggle from '$lib/components/settings/Toggle.svelte'
  import { open } from '@tauri-apps/plugin-dialog'
  import { invoke } from '@tauri-apps/api/core'
  import { isAndroid } from '$lib/platform'

  // Player cache-size presets (MiB). "Custom" reveals a free-entry field; "Uncapped" removes the
  // ceiling. Every preset is a baseline that auto-scales up with the file's bitrate at play time.
  const cachePresets = [{ label: 'Low', mb: 32 }, { label: 'Balanced', mb: 128 }, { label: 'High', mb: 256 }]
  let cacheCustomMode = $state(false)
  const cacheIsUncapped = $derived($playerCacheMb === CACHE_UNCAPPED)
  const cacheIsCustom = $derived(!cacheIsUncapped && !cachePresets.some((p) => p.mb === $playerCacheMb))

  // Clear the on-disk scrub-thumbnail cache (frees space; regenerates on demand).
  let clearing = $state(false)
  let cacheMsg = $state('')
  async function clearCache() {
    clearing = true
    try {
      const freed = await invoke<number>('clear_video_cache')
      cacheMsg = freed > 0
        ? `Freed ${freed >= 1_000_000 ? (freed / 1_000_000).toFixed(1) + ' MB' : Math.max(1, Math.round(freed / 1000)) + ' KB'}.`
        : 'Cache was already empty.'
    } catch (e) {
      cacheMsg = 'Failed to clear: ' + (e instanceof Error ? e.message : String(e))
    } finally {
      clearing = false
    }
  }

  // Native file picker for the external-player executable.
  async function browsePlayer() {
    try {
      const path = await open({
        multiple: false,
        directory: false,
        title: 'Select external player',
        filters: [{ name: 'Executable', extensions: ['exe', 'AppImage', 'sh', 'app'] }, { name: 'All files', extensions: ['*'] }],
      })
      if (typeof path === 'string') $externalPlayerPath = path
    } catch { /* user cancelled */ }
  }
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Player</h2>
  <p class="mb-4 text-sm text-muted-foreground">Languages, playback behaviour, and the external player.</p>

  <div class="mb-4 grid max-w-2xl gap-3 sm:grid-cols-2">
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

  <!-- The in-app player is desktop-only. On Android playback hands off to an external video
       app, so none of these mpv-side controls apply — hide them and say why. -->
  {#if $isAndroid}
    <p class="max-w-2xl rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
      Playback opens in your device's video player (whichever you pick from the "Open with…" chooser). The in-app player options below don't apply on this platform.
    </p>
  {:else}
  <div class="max-w-2xl space-y-3">
    <Toggle label="Auto-play next episode" desc="Play the next episode automatically when one finishes." value={$autoplayNext} onToggle={() => ($autoplayNext = !$autoplayNext)} />
    <Toggle label="Binge next episode (preload)" desc="Keep the same release across episodes and pre-resolve + warm-buffer the next one near the end, so Next / auto-play starts instantly." value={$bingePreload} onToggle={() => ($bingePreload = !$bingePreload)} />
    <Toggle label="Auto-skip openings & endings" desc="Skip OP/ED/recap segments automatically (AniSkip). Off shows a manual Skip button." value={$autoSkip} onToggle={() => ($autoSkip = !$autoSkip)} />
    <Toggle label="Skip filler episodes" desc="Auto next-episode jumps past filler (AnimeFillerList). Filler is always marked in the episode list." value={$skipFiller} onToggle={() => ($skipFiller = !$skipFiller)} />
    <Toggle label="Scrub preview thumbnails" desc="Show a frame preview while skimming the seek bar. Off shows just the time and chapter (and skips the frame grab — lighter on the Deck)." value={$scrubThumbnails} onToggle={() => ($scrubThumbnails = !$scrubThumbnails)} />

    <!-- Player cache size: the main tunable RAM cost. Presets + Custom. -->
    <div class="rounded-md border border-border p-3">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0 pr-2">
          <div class="font-bold">Player cache size</div>
          <p class="mt-1 text-xs text-muted-foreground">How much video the player buffers in RAM. This is a baseline that automatically scales up for high-bitrate files (e.g. a 4K Blu-ray) so they don't rebuffer, while normal files stay near the preset. Lower frees memory; higher buffers more. <span class="text-foreground">Uncapped</span> buffers the whole file (up to 4 GiB) — most resistant to buffering, highest RAM. Applies to the next video.</p>
        </div>
        <div class="flex shrink-0 flex-wrap justify-end gap-1 rounded-lg bg-secondary p-1">
          {#each cachePresets as p (p.mb)}
            <button data-focusable onclick={() => { $playerCacheMb = p.mb; cacheCustomMode = false }}
              class="rounded-md px-2.5 py-1 text-xs font-bold transition {!cacheCustomMode && !cacheIsCustom && $playerCacheMb === p.mb ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}">{p.label}</button>
          {/each}
          <button data-focusable onclick={() => { cacheCustomMode = true; if (cacheIsUncapped) $playerCacheMb = 256 }}
            class="rounded-md px-2.5 py-1 text-xs font-bold transition {cacheCustomMode || cacheIsCustom ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}">Custom</button>
          <button data-focusable onclick={() => { $playerCacheMb = CACHE_UNCAPPED; cacheCustomMode = false }}
            class="rounded-md px-2.5 py-1 text-xs font-bold transition {cacheIsUncapped ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}">Uncapped</button>
        </div>
      </div>
      {#if (cacheCustomMode || cacheIsCustom) && !cacheIsUncapped}
        <div class="mt-3 flex items-center gap-2">
          <input type="number" min="16" max="4096" step="16" bind:value={$playerCacheMb} data-focusable
            class="w-28 rounded-md bg-input px-3 py-2 text-sm" />
          <span class="text-xs text-muted-foreground">MiB</span>
        </div>
      {/if}
    </div>

    <label class="flex items-center justify-between rounded-md border border-border p-3">
      <div>
        <div class="font-bold">Seek duration</div>
        <p class="mt-1 text-xs text-muted-foreground">Seconds the arrow keys jump.</p>
      </div>
      <span class="flex items-center gap-2">
        <input type="number" min="1" max="90" data-focusable bind:value={$seekDuration} class="w-20 rounded-md bg-input px-3 py-2 text-right text-sm" />
        <span class="text-sm text-muted-foreground">sec</span>
      </span>
    </label>

    <Toggle label="Enable external player" desc="Play in an external app (mpv/VLC/…) instead of the built-in player. No progress tracking or resume while external." value={$enableExternalPlayer} onToggle={() => ($enableExternalPlayer = !$enableExternalPlayer)} />
    {#if $enableExternalPlayer}
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">External video player</span>
        <span class="flex gap-2">
          <input type="text" data-focusable bind:value={$externalPlayerPath} placeholder="C:\Program Files\mpv\mpv.exe" class="flex-1 rounded-md bg-input px-3 py-2 text-sm" />
          <button data-focusable onclick={browsePlayer} class="shrink-0 rounded-md bg-secondary px-4 py-2 text-sm font-bold transition-colors hover:bg-accent">Browse…</button>
        </span>
        <span class="text-xs text-muted-foreground">Pick the player executable (mpv, VLC, …). The stream URL is passed as its only argument.</span>
      </label>
    {/if}

  </div>
  {/if}

  <h2 class="mb-1 mt-8 text-xl font-black">Interface</h2>
  <p class="mb-4 text-sm text-muted-foreground">How titles and lists are shown.</p>

  <div class="max-w-2xl">
    <label class="flex flex-col gap-1">
      <span class="text-sm font-bold">Title language</span>
      <select data-focusable bind:value={$titleLanguage} class="rounded-md bg-input px-3 py-2 text-sm sm:max-w-xs">
        <option value="romaji">Romaji</option>
        <option value="english">English</option>
      </select>
      <span class="text-xs text-muted-foreground">Show anime titles in Romaji (e.g. Shingeki no Kyojin) or English (Attack on Titan). Falls back to the other when a title has only one.</span>
    </label>

    {#if !$isAndroid}
    <div class="mt-3">
      <Toggle label="Title at top of player (Game mode)" desc="On the Deck, show the now-playing title at the top of the player (by the Back button) instead of just above the seek bar." value={$playerTitleTop} onToggle={() => ($playerTitleTop = !$playerTitleTop)} />
    </div>
    {/if}
  </div>

  {#if !$isAndroid}
  <h2 class="mb-1 mt-8 text-xl font-black">Storage</h2>
  <p class="mb-4 text-sm text-muted-foreground">Local playback caches.</p>

  <div class="max-w-2xl">
    <label class="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div>
        <div class="font-bold">Clear video cache</div>
        <p class="mt-1 text-xs text-muted-foreground">
          Removes cached scrub-preview thumbnails (they regenerate on demand).{cacheMsg ? ` ${cacheMsg}` : ''}
        </p>
      </div>
      <button data-focusable onclick={clearCache} disabled={clearing}
              class="shrink-0 rounded-md bg-secondary px-4 py-2 text-sm font-bold transition-colors hover:bg-accent disabled:opacity-50">
        {clearing ? 'Clearing…' : 'Clear'}
      </button>
    </label>
  </div>
  {/if}
</div>
