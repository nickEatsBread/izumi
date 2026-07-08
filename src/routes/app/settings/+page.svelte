<script lang="ts">
  import {
    autoSkip, skipFiller, preferredAudioLang, preferredSubLang,
    autoplayNext, bingePreload, seekDuration, enableExternalPlayer, externalPlayerPath,
    scrubThumbnails, titleLanguage, playerTitleTop,
  } from '$lib/settings/ui'
  import Toggle from '$lib/components/settings/Toggle.svelte'
  import { open } from '@tauri-apps/plugin-dialog'
  import { invoke } from '@tauri-apps/api/core'

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

<div class="p-8">
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

  <div class="max-w-2xl space-y-3">
    <Toggle label="Auto-play next episode" desc="Play the next episode automatically when one finishes." value={$autoplayNext} onToggle={() => ($autoplayNext = !$autoplayNext)} />
    <Toggle label="Binge next episode (preload)" desc="Keep the same release across episodes and pre-resolve + warm-buffer the next one near the end, so Next / auto-play starts instantly." value={$bingePreload} onToggle={() => ($bingePreload = !$bingePreload)} />
    <Toggle label="Auto-skip openings & endings" desc="Skip OP/ED/recap segments automatically (AniSkip). Off shows a manual Skip button." value={$autoSkip} onToggle={() => ($autoSkip = !$autoSkip)} />
    <Toggle label="Skip filler episodes" desc="Auto next-episode jumps past filler (AnimeFillerList). Filler is always marked in the episode list." value={$skipFiller} onToggle={() => ($skipFiller = !$skipFiller)} />
    <Toggle label="Scrub preview thumbnails" desc="Show a frame preview while skimming the seek bar. Off shows just the time and chapter (and skips the frame grab — lighter on the Deck)." value={$scrubThumbnails} onToggle={() => ($scrubThumbnails = !$scrubThumbnails)} />

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

    <div class="mt-3">
      <Toggle label="Title at top of player (Game mode)" desc="On the Deck, show the now-playing title at the top of the player (by the Back button) instead of just above the seek bar." value={$playerTitleTop} onToggle={() => ($playerTitleTop = !$playerTitleTop)} />
    </div>
  </div>

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
</div>
