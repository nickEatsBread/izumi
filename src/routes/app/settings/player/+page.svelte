<script lang="ts">
  import {
    autoSkip, skipFiller, preferredAudioLang, preferredSubLang,
    autoplayNext, bingePreload, seekDuration, enableExternalPlayer, externalPlayerPath,
    scrubThumbnails, playerProgressAnimations, titleLanguage, playerTitleTop, playerCacheMb, CACHE_UNCAPPED, keepAwakeWhilePlaying,
    videoQualityPreset, rawMpvOptions, gifIncludeSubtitles, gifScale, gifMaxSeconds, androidAutoPip,
    audioProcessing, windowsVsr, systemMediaControls, discordRichPresence, subtitleLineNavigation,
    p2pStatusVisibility,
    continueSourcePreference,
  } from '$lib/settings/ui'
  import { qualityNotice, qualityFailedKeys } from '$lib/player/quality'
  import Toggle from '$lib/components/settings/Toggle.svelte'
  import { open } from '@tauri-apps/plugin-dialog'
  import { invoke } from '@tauri-apps/api/core'
  import { isAndroid } from '$lib/platform'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'

  let pendingAnime = $state(false) // shows the one-time shader consent

  // Neural upscale shaders are desktop-only. A persisted Anime value from another
  // device would otherwise sit on a SelectMenu option that Android does not list.
  $effect(() => {
    if ($isAndroid && $videoQualityPreset === 'anime') $videoQualityPreset = 'high'
  })

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
      <SelectMenu bind:value={$preferredAudioLang} ariaLabel="Audio language" options={[
        { value: 'jpn', label: 'Japanese' },
        { value: 'eng', label: 'English' },
      ]} />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-sm font-bold">Subtitle language</span>
      <SelectMenu bind:value={$preferredSubLang} ariaLabel="Subtitle language" options={[
        { value: 'eng', label: 'English' },
        { value: 'jpn', label: 'Japanese' },
        { value: 'none', label: 'Off' },
      ]} />
    </label>

    <!-- Video-quality presets drive desktop mpv and the embedded Android libmpv plugin.
         Anime shaders need the desktop-only `ensure_upscale_shader` download, so that
         option stays off Android. Windows VSR is d3d11-only. -->
    <label class="flex flex-col gap-1">
      <span class="text-sm font-bold">Video quality</span>
      <SelectMenu
        value={$videoQualityPreset}
        ariaLabel="Video quality"
        onChange={(value) => {
          const v = value as typeof $videoQualityPreset
          if (v === 'anime') { pendingAnime = true; return } // confirm download first
          $videoQualityPreset = v
        }}
        options={[
          { value: 'performance', label: 'Performance' },
          { value: 'standard', label: 'Standard' },
          { value: 'high', label: 'High Quality' },
          ...($isAndroid ? [] : [{ value: 'anime', label: 'Anime (neural upscale)' }]),
          { value: 'custom', label: 'Custom…' },
        ]}
      />
      <span class="text-xs text-muted-foreground">Standard keeps stock mpv quality flags (sigmoid / correct / linear scaling). High Quality adds ewa scaling, debanding, and stock [high-quality] HDR peak handling. Performance is bilinear for weak GPUs.</span>
    </label>

    {#if pendingAnime}
      <div class="col-span-full rounded-md bg-input p-3 text-sm">
        <!-- Size is the real asset size measured against the pinned release (~208 KB today); the
             download is one-time and cached under the app config dir. -->
        <p class="mb-2">Anime mode needs a shader file (~200 KB) that isn't bundled with the app. Turning it on downloads that file from the internet once, then keeps using the local copy. Download it now?</p>
        <button class="mr-2 rounded bg-primary px-3 py-1 font-bold" onclick={() => { pendingAnime = false; $videoQualityPreset = 'anime' }}>Download</button>
        <button class="rounded bg-muted px-3 py-1" onclick={() => { pendingAnime = false }}>Cancel</button>
      </div>
    {/if}

    {#if $qualityNotice}
      <p class="col-span-full text-sm text-yellow-500">{$qualityNotice}</p>
    {/if}

    {#if $videoQualityPreset === 'custom'}
      <label class="col-span-full flex flex-col gap-1">
        <span class="text-sm font-bold">Custom mpv options</span>
        <textarea
          data-focusable
          class="min-h-32 rounded-md bg-input px-3 py-2 font-mono text-xs"
          placeholder="scale=ewa_lanczossharp&#10;deband=yes&#10;glsl-shaders=C:/path/to/shader.glsl"
          bind:value={$rawMpvOptions}
        ></textarea>
        <span class="text-xs text-muted-foreground">One <code>key=value</code> per line. Applies live; some options only take effect on the next video.</span>
        {#if $qualityFailedKeys.length}
          <span class="text-xs text-yellow-500">No live effect (check spelling, or applies next video): {$qualityFailedKeys.join(', ')}</span>
        {/if}
      </label>
    {/if}

    {#if !$isAndroid}
    <label class="flex flex-col gap-1">
      <span class="text-sm font-bold">Windows driver upscaling</span>
      <SelectMenu bind:value={$windowsVsr} ariaLabel="Windows driver upscaling" options={[
        { value: 'off', label: 'Off' },
        { value: 'nvidia', label: 'NVIDIA RTX VSR' },
        { value: 'intel', label: 'Intel VSR' },
      ]} />
      <span class="text-xs text-muted-foreground">Uses mpv's d3d11vpp path. Windows and a supported driver are required.</span>
    </label>
    {/if}
  </div>

  <label class="mb-4 flex max-w-2xl flex-col gap-1 rounded-md border border-border p-3">
    <span class="text-sm font-bold">Audio processing</span>
    <SelectMenu bind:value={$audioProcessing} ariaLabel="Audio processing" options={[
      { value: 'off', label: 'Off' },
      { value: 'dialogue', label: 'Dialogue boost' },
      { value: 'night', label: 'Night mode' },
      { value: 'boost', label: 'Volume boost' },
    ]} />
    <span class="text-xs text-muted-foreground">Dialogue evens out speech. Night mode compresses loud openings. Volume boost raises quiet rips and limits peaks. Disable passthrough on an external receiver when using a filter.</span>
  </label>

  <label class="mb-4 flex max-w-2xl flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
    <span class="min-w-0">
      <span class="block font-bold">P2P playback status</span>
      <span class="mt-1 block text-xs text-muted-foreground">Show live download, upload, peer, and progress details over Direct P2P playback. Debrid playback is never included.</span>
    </span>
    <SelectMenu className="w-full shrink-0 sm:w-56" bind:value={$p2pStatusVisibility} ariaLabel="P2P playback status" options={[
      { value: 'hidden', label: 'Always hidden' },
      { value: 'buffering', label: 'While buffering' },
      { value: 'initial', label: 'Initial buffering only' },
      { value: 'always', label: 'Always visible' },
    ]} />
  </label>

  <label class="mb-4 flex max-w-2xl flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
    <span class="min-w-0">
      <span class="block font-bold">Continue Watching source</span>
      <span class="mt-1 block text-xs text-muted-foreground">Choose when Continue Watching briefly prefers a recent source. Source memories expire after 30 days; alternatives still resolve in parallel.</span>
    </span>
    <SelectMenu className="w-full shrink-0 sm:w-56" bind:value={$continueSourcePreference} ariaLabel="Continue Watching source" options={[
      { value: 'resumed', label: 'Resumed episodes' },
      { value: 'always', label: 'Every episode' },
      { value: 'never', label: 'Never' },
    ]} />
  </label>

  <!-- The mpv-side tuning below (cache, quality presets, external player) is desktop-only; Android
       gets the handful of options that do apply to the built-in player. -->
  {#if $isAndroid}
    <p class="max-w-2xl rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
      Playback uses the built-in player on the full build, or your device's video player on the lite build. The mpv tuning options further down don't apply on this platform.
    </p>
    <!-- The in-app player builds record GIFs from the live video; the recorder itself lives in the
         player's own settings sheet, but this is the same preference the desktop build exposes. -->
    <div class="mt-3 max-w-2xl space-y-3">
      <Toggle label="Miniplayer when you leave the app" desc="Leaving izumi (home or recents) while a video is playing shrinks it into a floating miniplayer instead of leaving it on the watch page. Off leaves the app normally; playback keeps running with the notification controls either way." value={$androidAutoPip} onToggle={() => ($androidAutoPip = !$androidAutoPip)} />
      <Toggle label="Include subtitles in GIFs" desc="Burn the currently displayed subtitle track into GIF recordings. Recording is started from the player's settings sheet." value={$gifIncludeSubtitles} onToggle={() => ($gifIncludeSubtitles = !$gifIncludeSubtitles)} />
    </div>
  {:else}
  <div class="max-w-2xl space-y-3">
    <Toggle label="Auto-play next episode" desc="Play the next episode automatically when one finishes." value={$autoplayNext} onToggle={() => ($autoplayNext = !$autoplayNext)} />
    {#if !$isAndroid}
      <Toggle label="System media controls" desc="Show playback metadata and Play, Pause, Previous, Next, and seek actions in Windows SMTC or Linux MPRIS controls. Adult titles show no name, series, or artwork there — only the controls." value={$systemMediaControls} onToggle={() => ($systemMediaControls = !$systemMediaControls)} />
      <Toggle label="Discord Rich Presence" desc="Share the current series, episode, cover art, and progress with Discord. On by default; adult titles are never shared." value={$discordRichPresence} onToggle={() => ($discordRichPresence = !$discordRichPresence)} />
    {/if}
    <Toggle label="Keep screen awake while playing" desc="Stop the screen dimming or sleeping during playback (fixes the Steam Deck screen turning off mid-episode). Releases when paused, so battery-saver still works when you're not watching." value={$keepAwakeWhilePlaying} onToggle={() => ($keepAwakeWhilePlaying = !$keepAwakeWhilePlaying)} />
    <Toggle label="Binge next episode (preload)" desc="Keep the same release across episodes and pre-resolve + warm-buffer the next one near the end, so Next / auto-play starts instantly." value={$bingePreload} onToggle={() => ($bingePreload = !$bingePreload)} />
    <Toggle label="Auto-skip openings & endings" desc="Skip OP/ED/recap segments automatically (AniSkip). Off shows a manual Skip button." value={$autoSkip} onToggle={() => ($autoSkip = !$autoSkip)} />
    <Toggle label="Skip filler episodes" desc="Auto next-episode jumps past filler (AnimeFillerList). Filler is always marked in the episode list." value={$skipFiller} onToggle={() => ($skipFiller = !$skipFiller)} />
    <Toggle label="Scrub preview thumbnails" desc="Show a frame preview while skimming the seek bar. Off shows just the time and chapter (and skips the frame grab — lighter on the Deck)." value={$scrubThumbnails} onToggle={() => ($scrubThumbnails = !$scrubThumbnails)} />
    <Toggle label="Animate player progress controls" desc="Animate the Game-mode progress bar and controls as they appear and disappear. Turn off for instant controls." value={$playerProgressAnimations} onToggle={() => ($playerProgressAnimations = !$playerProgressAnimations)} />
    <Toggle label="Subtitle line navigation" desc="Show Previous, Replay, and Next subtitle-cue controls in the player. Useful for language learning; off by default." value={$subtitleLineNavigation} onToggle={() => ($subtitleLineNavigation = !$subtitleLineNavigation)} />
    <div class="rounded-md border border-border p-3 space-y-3" data-setting-key="gif-recorder">
      <div>
        <div class="font-bold">GIF recorder</div>
        <p class="mt-1 text-xs text-muted-foreground">Unencrypted playback cuts the moment from the file. Encrypted playback grabs every compositor frame it can for as long as you hold record.</p>
      </div>
      <Toggle label="Include subtitles" desc="Burn the currently displayed subtitle track into the GIF." value={$gifIncludeSubtitles} onToggle={() => ($gifIncludeSubtitles = !$gifIncludeSubtitles)} />
      <label class="flex items-center justify-between gap-4">
        <span class="min-w-0">
          <span class="block font-bold">Width</span>
          <span class="mt-1 block text-xs text-muted-foreground">Height follows the video. 480px is mobile-safe; 720px is the usual desktop share size.</span>
        </span>
        <SelectMenu className="w-28 shrink-0" value={String($gifScale)} onChange={(value) => { $gifScale = Number(value) }} ariaLabel="GIF width" options={[
          { value: '480', label: '480px' },
          { value: '720', label: '720px' },
          { value: '960', label: '960px' },
        ]} />
      </label>
      <label class="flex items-center justify-between gap-4">
        <span class="min-w-0">
          <span class="block font-bold">Max length</span>
          <span class="mt-1 block text-xs text-muted-foreground">Recording stops automatically. 5–10 seconds is what most chats actually play.</span>
        </span>
        <SelectMenu className="w-28 shrink-0" value={String($gifMaxSeconds)} onChange={(value) => { $gifMaxSeconds = Number(value) }} ariaLabel="GIF max length" options={[
          { value: '5', label: '5 sec' },
          { value: '10', label: '10 sec' },
          { value: '15', label: '15 sec' },
          { value: '30', label: '30 sec' },
        ]} />
      </label>
    </div>

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
      <SelectMenu bind:value={$titleLanguage} className="sm:max-w-xs" ariaLabel="Title language" options={[
        { value: 'romaji', label: 'Romaji' },
        { value: 'english', label: 'English' },
      ]} />
      <span class="text-xs text-muted-foreground">Show anime titles in Romaji (e.g. Shingeki no Kyojin) or English (Attack on Titan). Falls back to the other when a title has only one.</span>
    </label>

    {#if !$isAndroid}
    <div class="mt-3">
      <Toggle label="Title at top of player (Game mode)" desc="On the Deck, show the now-playing title at the top of the screen instead of just above the seek bar." value={$playerTitleTop} onToggle={() => ($playerTitleTop = !$playerTitleTop)} />
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
