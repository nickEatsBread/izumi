<script lang="ts">
  import {
    autoSkip, skipPreviews, skipFiller, autoplayNext, upNextOverlay, seriesRatingPrompt, bingePreload,
    seekDuration, enableExternalPlayer, externalPlayerPath, scrubThumbnails, playerProgressAnimations,
    playerTitleTop, playerCacheMb, CACHE_UNCAPPED, keepAwakeWhilePlaying, videoQualityPreset, rawMpvOptions,
    gifIncludeSubtitles, gifScale, gifMaxSeconds, androidAutoPip, audioProcessing, windowsVsr,
    systemMediaControls, discordRichPresence, subtitleLineNavigation, hideSidebarWhilePlaying,
    audioOutputMode, audioOutputDevice, audioExclusive,
    audioPassthroughAc3, audioPassthroughEac3, audioPassthroughTruehd,
    audioPassthroughDts, audioPassthroughDtsHd, dolbyVisionOutputMode,
    p2pStatusVisibility, continueSourcePreference,
    developerLogging,
    autoSelectSource, autoSelectCountdown, preferredQuality, adaptiveSourceMode, seadexAnnotations,
  } from '$lib/settings/ui'
  import { qualityNotice, qualityFailedKeys } from '$lib/player/quality'
  import {
    classifyAudioOutput, classifyVideoOutput, dolbyCapabilities, dolbyCapabilityError,
    refreshDolbyCapabilities, applyDolbySettings,
  } from '$lib/player/dolby'
  import { drmDolbyStatus } from '$lib/player/drm-dolby'
  import { open } from '@tauri-apps/plugin-dialog'
  import { isAndroid, isAndroidTv, isWindows } from '$lib/platform'
  import { inAppPlayerAvailable } from '$lib/player/in-app-player'
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsChoiceRow from '$lib/components/settings/SettingsChoiceRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import HotkeyBindings from '$lib/components/settings/HotkeyBindings.svelte'
  import { m } from '$lib/paraglide/messages.js'
  import { tick } from 'svelte'
  import { handFocusBack } from '$lib/nav/focus-memory'

  let pendingAnime = $state(false) // shows the one-time shader consent
  let qualityRow = $state<HTMLDivElement>()

  // Answering the Anime shader prompt removes the button that held focus. Focus goes back to the
  // Rendering preset trigger, so the next d-pad press continues from the setting that asked (spec
  // §3.9); after a mouse or touch answer only a focus hint is left for the first d-pad press.
  async function answerAnimeConsent(download: boolean) {
    pendingAnime = false
    if (download) $videoQualityPreset = 'anime'
    await tick()
    handFocusBack(qualityRow?.querySelector<HTMLElement>('button[aria-haspopup="listbox"]'))
  }

  function chooseRenderingPreset(value: string) {
    if (value === 'anime') { pendingAnime = true; return } // confirm download first
    $videoQualityPreset = value as typeof $videoQualityPreset
  }

  // Neural upscale shaders are desktop-only. A persisted Anime value from another
  // device would otherwise sit on a menu option that Android does not list.
  $effect(() => {
    if ($isAndroid && $videoQualityPreset === 'anime') $videoQualityPreset = 'high'
  })

  // Player cache-size presets (MiB). "Custom" reveals a free-entry field; "Uncapped" removes the
  // ceiling. Every preset is a baseline that auto-scales up with the file's bitrate at play time.
  const cachePresets = [{ label: 'Low', mb: 32 }, { label: 'Balanced', mb: 128 }, { label: 'High', mb: 256 }]
  let cacheCustomMode = $state(false)
  const cacheIsUncapped = $derived($playerCacheMb === CACHE_UNCAPPED)
  const cacheIsCustom = $derived(!cacheIsUncapped && !cachePresets.some((p) => p.mb === $playerCacheMb))
  const cacheChoice = $derived(cacheIsUncapped ? 'uncapped' : cacheCustomMode || cacheIsCustom ? 'custom' : String($playerCacheMb))
  const cacheOptions = [
    ...cachePresets.map((p) => ({ value: String(p.mb), label: p.label, description: `${p.mb} MiB` })),
    { value: 'custom', label: 'Custom' },
    { value: 'uncapped', label: 'Uncapped', description: 'Up to 4 GiB' },
  ]
  function chooseCache(value: string) {
    cacheCustomMode = value === 'custom'
    if (value === 'uncapped') $playerCacheMb = CACHE_UNCAPPED
    else if (value === 'custom') { if (cacheIsUncapped) $playerCacheMb = 256 }
    else $playerCacheMb = Number(value)
  }

  // Android seek step (spec §5.1): a menu of presets, because a number field owns every arrow key
  // on a TV remote and opens the keyboard on a phone. A value set elsewhere (typed on a desktop, or
  // restored from a backup) that is not a preset stays listed, so the menu never shows a wrong value.
  const SEEK_PRESETS = [5, 10, 15, 20, 30, 45, 60, 90]
  const seekOptions = $derived(
    [...new Set([...SEEK_PRESETS, Number($seekDuration)])]
      .filter((seconds) => Number.isFinite(seconds) && seconds >= 1 && seconds <= 90)
      .sort((a, b) => a - b)
      .map((seconds) => ({ value: String(seconds), label: `${seconds} sec` })),
  )

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

  // One control over two stores: whether to auto-pick at all, and whether to wait first. The second
  // only means anything when the first is on.
  const autoMode = $derived(!$autoSelectSource ? 'off' : $autoSelectCountdown ? 'countdown' : 'instant')
  function setAutoMode(mode: string) {
    $autoSelectSource = mode !== 'off'
    if (mode !== 'off') $autoSelectCountdown = mode === 'countdown'
  }
  const AUTO_MODE_NOTES: Record<string, string> = {
    off: 'The source list stays open until you pick one.',
    instant: 'The best cached match plays as soon as the list settles.',
    countdown: 'The best cached match plays after the Auto button fills.',
  }
  const PLANNER_NOTES: Record<string, string> = {
    active: 'Adapts automatic choices using recent outcomes on this device.',
    shadow: 'Learns from recent outcomes without changing playback yet.',
    off: 'Only the established source ranking is used.',
  }

  const audioOutput = $derived(classifyAudioOutput($dolbyCapabilities.current))
  const videoOutput = $derived(classifyVideoOutput(
    $dolbyCapabilities.current,
    $dolbyCapabilities.video.nativeHdrType || $dolbyCapabilities.video.dolbyVisionNativePath,
  ))
</script>

<SettingsSection section="playback">
  <!-- Per-row platform gates (spec §5.1). A row shows wherever the player that reads it runs.
       $inAppPlayerAvailable is every desktop build and the Android full build; the Android lite
       build hands videos to the device's own player and shows the notice instead. Rows under
       !$isAndroid are desktop-only. A subcategory whose rows all need the in-app player sits under
       the same gate, so no empty card renders. -->
  {#if !$inAppPlayerAvailable}
    <p class="mb-7 rounded-xl border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
      This build plays videos in your device's video player, so the in-app player options are not shown.
    </p>
  {/if}

  <SettingsSubcategory id="up-next">
    {#if $inAppPlayerAvailable}
      <SettingsRow settingKey="auto-play-next-episode" title={m.player_autoplay_next()} description={m.player_autoplay_next_hint()} onActivate={() => ($autoplayNext = !$autoplayNext)} pressed={$autoplayNext}>
        {#snippet control()}<SettingsSwitch value={$autoplayNext} onToggle={() => ($autoplayNext = !$autoplayNext)} label={m.player_autoplay_next()} interactive={false} />{/snippet}
      </SettingsRow>
      <SettingsRow settingKey="show-up-next-countdown" title={m.player_up_next_overlay()} description={m.player_up_next_overlay_hint()} onActivate={() => ($upNextOverlay = !$upNextOverlay)} pressed={$upNextOverlay}>
        {#snippet control()}<SettingsSwitch value={$upNextOverlay} onToggle={() => ($upNextOverlay = !$upNextOverlay)} label={m.player_up_next_overlay()} interactive={false} />{/snippet}
      </SettingsRow>
      <SettingsRow settingKey="binge-next-episode-preload" title="Binge next episode (preload)" description="Preloads the next episode; it then starts by itself, even with Auto-play off." learnMore="Keeps the same release across episodes and resolves and buffers the next one near the end, so Next and auto-play start instantly." onActivate={() => ($bingePreload = !$bingePreload)} pressed={$bingePreload}>
        {#snippet control()}<SettingsSwitch value={$bingePreload} onToggle={() => ($bingePreload = !$bingePreload)} label="Binge next episode (preload)" interactive={false} />{/snippet}
      </SettingsRow>
    {/if}
    <SettingsRow settingKey="ask-for-a-rating-when-a-series-ends" title={m.player_series_rating_prompt()} description={m.player_series_rating_prompt_hint()} learnMore={m.player_series_rating_prompt_more()} onActivate={() => ($seriesRatingPrompt = !$seriesRatingPrompt)} pressed={$seriesRatingPrompt}>
      {#snippet control()}<SettingsSwitch value={$seriesRatingPrompt} onToggle={() => ($seriesRatingPrompt = !$seriesRatingPrompt)} label={m.player_series_rating_prompt()} interactive={false} />{/snippet}
    </SettingsRow>
  </SettingsSubcategory>

  {#if $inAppPlayerAvailable}
    <SettingsSubcategory id="skipping">
      <SettingsRow settingKey="auto-skip-openings-endings" title="Auto-skip openings & endings" description="Skips openings, recaps and endings. Off shows a Skip button instead." learnMore="Uses community skip times and the file's own chapters." onActivate={() => ($autoSkip = !$autoSkip)} pressed={$autoSkip}>
        {#snippet control()}<SettingsSwitch value={$autoSkip} onToggle={() => ($autoSkip = !$autoSkip)} label="Auto-skip openings & endings" interactive={false} />{/snippet}
      </SettingsRow>
      <SettingsRow settingKey="auto-skip-next-episode-previews" title="Auto-skip next-episode previews" description="Skips the preview after the ending. Needs auto-skip on." learnMore="Only when the file marks a preview. Off still shows a Skip button for it." onActivate={() => ($skipPreviews = !$skipPreviews)} pressed={$skipPreviews}>
        {#snippet control()}<SettingsSwitch value={$skipPreviews} onToggle={() => ($skipPreviews = !$skipPreviews)} label="Auto-skip next-episode previews" interactive={false} />{/snippet}
      </SettingsRow>
      <SettingsRow settingKey="skip-filler-episodes" title="Skip filler episodes" description="Next episode jumps past filler. Filler stays marked in the episode list." learnMore="Filler data comes from AnimeFillerList." onActivate={() => ($skipFiller = !$skipFiller)} pressed={$skipFiller}>
        {#snippet control()}<SettingsSwitch value={$skipFiller} onToggle={() => ($skipFiller = !$skipFiller)} label="Skip filler episodes" interactive={false} />{/snippet}
      </SettingsRow>
    </SettingsSubcategory>
  {/if}

  {#if $inAppPlayerAvailable}
    <SettingsSubcategory id="seeking">
      {#if $isAndroid}
        <SettingsChoiceRow settingKey="seek-duration" title="Seek duration" description="Seconds the skip buttons, a double-tap and remote arrows jump." value={String($seekDuration)} onChange={(value) => ($seekDuration = Number(value))} options={seekOptions} />
      {:else}
        <SettingsRow settingKey="seek-duration" title="Seek duration" description="Seconds the arrow keys jump.">
          {#snippet control()}
            <input type="number" min="1" max="90" data-focusable aria-label="Seek duration" bind:value={$seekDuration} class="w-20 rounded-md bg-input px-3 py-2 text-right text-sm" />
            <span class="text-sm text-muted-foreground">sec</span>
          {/snippet}
        </SettingsRow>
      {/if}
      <SettingsRow settingKey="scrub-preview-thumbnails" title="Scrub preview thumbnails" description="Frame previews while skimming the seek bar. Off shows time and chapter." learnMore="Off also skips the frame grab, which is lighter on the Steam Deck." onActivate={() => ($scrubThumbnails = !$scrubThumbnails)} pressed={$scrubThumbnails}>
        {#snippet control()}<SettingsSwitch value={$scrubThumbnails} onToggle={() => ($scrubThumbnails = !$scrubThumbnails)} label="Scrub preview thumbnails" interactive={false} />{/snippet}
      </SettingsRow>
    </SettingsSubcategory>
  {/if}

  {#if $inAppPlayerAvailable}
    <SettingsSubcategory id="player-window">
      {#if $isAndroid && !$isAndroidTv}
        <SettingsRow settingKey="miniplayer-when-you-leave-the-app" title="Miniplayer when you leave the app" description="Shrinks a playing video into a floating window when you leave izumi." learnMore="Applies when you go to the home screen or recents while a video plays. Off leaves the app normally; playback keeps running with the notification controls either way." onActivate={() => ($androidAutoPip = !$androidAutoPip)} pressed={$androidAutoPip}>
          {#snippet control()}<SettingsSwitch value={$androidAutoPip} onToggle={() => ($androidAutoPip = !$androidAutoPip)} label="Miniplayer when you leave the app" interactive={false} />{/snippet}
        </SettingsRow>
      {/if}
      <SettingsRow settingKey="keep-screen-awake-while-playing" title="Keep screen awake while playing" description="Stops the screen dimming or sleeping during playback. Released when paused." learnMore="Fixes the Steam Deck screen turning off mid-episode. Because it releases on pause, battery saving still works when you're not watching." onActivate={() => ($keepAwakeWhilePlaying = !$keepAwakeWhilePlaying)} pressed={$keepAwakeWhilePlaying}>
        {#snippet control()}<SettingsSwitch value={$keepAwakeWhilePlaying} onToggle={() => ($keepAwakeWhilePlaying = !$keepAwakeWhilePlaying)} label="Keep screen awake while playing" interactive={false} />{/snippet}
      </SettingsRow>
      {#if !$isAndroid}
        <SettingsRow settingKey="system-media-controls" title="System media controls" description="Show the title and playback buttons in system media controls." learnMore="Uses Windows SMTC or Linux MPRIS, with Play, Pause, Previous, Next and seek. Adult titles show only the controls: no name, series or artwork." onActivate={() => ($systemMediaControls = !$systemMediaControls)} pressed={$systemMediaControls}>
          {#snippet control()}<SettingsSwitch value={$systemMediaControls} onToggle={() => ($systemMediaControls = !$systemMediaControls)} label="System media controls" interactive={false} />{/snippet}
        </SettingsRow>
        <SettingsRow settingKey="discord-rich-presence" title="Discord Rich Presence" description="Share the series, episode, cover and progress on Discord." learnMore="On by default. Adult titles are never shared." onActivate={() => ($discordRichPresence = !$discordRichPresence)} pressed={$discordRichPresence}>
          {#snippet control()}<SettingsSwitch value={$discordRichPresence} onToggle={() => ($discordRichPresence = !$discordRichPresence)} label="Discord Rich Presence" interactive={false} />{/snippet}
        </SettingsRow>
        <SettingsRow settingKey="hide-sidebar-while-playing" title="Hide sidebar while playing" description="Tucks the sidebar away while a video is open, so the player fills the window." learnMore="It comes back when you leave the player. Has no effect when the navigation sits at the top or bottom." onActivate={() => ($hideSidebarWhilePlaying = !$hideSidebarWhilePlaying)} pressed={$hideSidebarWhilePlaying}>
          {#snippet control()}<SettingsSwitch value={$hideSidebarWhilePlaying} onToggle={() => ($hideSidebarWhilePlaying = !$hideSidebarWhilePlaying)} label="Hide sidebar while playing" interactive={false} />{/snippet}
        </SettingsRow>
      {/if}
      <SettingsChoiceRow settingKey="p2p-playback-status" title="P2P playback status" description="Peers and live speeds at the top of the player during Direct P2P playback." learnMore="Debrid playback never shows it." value={$p2pStatusVisibility} onChange={(value) => ($p2pStatusVisibility = value as typeof $p2pStatusVisibility)} options={[
        { value: 'hidden', label: 'Always hidden' },
        { value: 'buffering', label: 'While buffering' },
        { value: 'initial', label: 'Initial buffering only' },
        { value: 'always', label: 'Always visible' },
      ]} />
      {#if !$isAndroid}
        <div data-setting-key="gif-recorder" class="divide-y divide-border/70">
          <SettingsRow settingKey="include-subtitles-in-gifs" title="Include subtitles in GIFs" description="Burn the currently displayed subtitle track into the GIF." learnMore="Unencrypted playback cuts the moment from the file. Encrypted playback grabs every compositor frame it can for as long as you hold record." onActivate={() => ($gifIncludeSubtitles = !$gifIncludeSubtitles)} pressed={$gifIncludeSubtitles}>
            {#snippet control()}<SettingsSwitch value={$gifIncludeSubtitles} onToggle={() => ($gifIncludeSubtitles = !$gifIncludeSubtitles)} label="Include subtitles in GIFs" interactive={false} />{/snippet}
          </SettingsRow>
          <SettingsChoiceRow settingKey="gif-width" title="GIF width" description="Height follows the video. 480px suits phones, 720px desktop shares." value={String($gifScale)} onChange={(value) => ($gifScale = Number(value))} options={[
            { value: '480', label: '480px' },
            { value: '720', label: '720px' },
            { value: '960', label: '960px' },
          ]} />
          <SettingsChoiceRow settingKey="gif-max-length" title="GIF max length" description="Recording stops automatically. 5–10 seconds is what most chats actually play." value={String($gifMaxSeconds)} onChange={(value) => ($gifMaxSeconds = Number(value))} options={[
            { value: '5', label: '5 sec' },
            { value: '10', label: '10 sec' },
            { value: '15', label: '15 sec' },
            { value: '30', label: '30 sec' },
          ]} />
        </div>
      {:else}
        <!-- Android records GIFs from the player's own settings sheet; only the subtitle choice lives here. -->
        <SettingsRow settingKey="include-subtitles-in-gifs" title="Include subtitles in GIFs" description="Burn the currently displayed subtitle track into the GIF." learnMore="Start a recording from the player's settings sheet." onActivate={() => ($gifIncludeSubtitles = !$gifIncludeSubtitles)} pressed={$gifIncludeSubtitles}>
          {#snippet control()}<SettingsSwitch value={$gifIncludeSubtitles} onToggle={() => ($gifIncludeSubtitles = !$gifIncludeSubtitles)} label="Include subtitles in GIFs" interactive={false} />{/snippet}
        </SettingsRow>
      {/if}
    </SettingsSubcategory>
  {/if}

  <SettingsSubcategory id="quality">
    <SettingsChoiceRow settingKey="auto-play-the-best-source" title="Auto-play the best source" description={AUTO_MODE_NOTES[autoMode]} learnMore="Auto plays the best cached match for your preferred quality. Immediately plays it as soon as the source list settles, with no chance to cancel. After a short countdown fills the Auto button left to right first; with Mark best releases on, it waits a moment longer for the curated verdict. Cancel the countdown by picking another source or interacting." value={autoMode} onChange={setAutoMode} options={[
      { value: 'countdown', label: 'After a short countdown' },
      { value: 'instant', label: 'Immediately' },
      { value: 'off', label: 'Off — always choose manually' },
    ]} />
    {#if $autoSelectSource}
      <SettingsChoiceRow settingKey="preferred-quality" title="Preferred quality" value={$preferredQuality} onChange={(value) => ($preferredQuality = value as typeof $preferredQuality)} options={[
        { value: '2160', label: '4K' },
        { value: '1080', label: '1080p' },
        { value: '720', label: '720p' },
        { value: '480', label: '480p' },
        { value: 'any', label: 'Any (highest available)' },
      ]} />
    {/if}
    <SettingsChoiceRow settingKey="continue-watching-source" title="Continue Watching source" description="When Continue Watching briefly prefers the source you last used." learnMore="Source memories expire after 30 days. Alternatives still resolve in parallel." value={$continueSourcePreference} onChange={(value) => ($continueSourcePreference = value as typeof $continueSourcePreference)} options={[
      { value: 'resumed', label: 'Resumed episodes' },
      { value: 'always', label: 'Every episode' },
      { value: 'never', label: 'Never' },
    ]} />
  </SettingsSubcategory>

  {#if !$isAndroid}
    <SettingsSubcategory id="controls" plain>
      <HotkeyBindings />
    </SettingsSubcategory>
  {/if}

  <SettingsSubcategory id="advanced" summary="Rendering preset, audio output, Dolby Vision and more">
    {#if $inAppPlayerAvailable}
      <!-- Rendering presets drive desktop mpv and the embedded Android libmpv plugin. Anime shaders
           need the desktop-only `ensure_upscale_shader` download, so that option stays off Android. -->
      <div bind:this={qualityRow} class="divide-y divide-border/70">
        <SettingsChoiceRow settingKey="rendering-preset" title="Rendering preset" description="How the player scales and filters video. Standard suits most GPUs." learnMore="Performance uses bilinear scaling for weak GPUs. Standard keeps mpv's stock quality flags (sigmoid, correct and linear scaling). High Quality adds EWA scaling, debanding and mpv's high-quality HDR peak handling. Anime downloads a neural upscale shader (desktop only). Custom uses your own mpv options." value={$videoQualityPreset} onChange={chooseRenderingPreset} options={[
          { value: 'performance', label: 'Performance' },
          { value: 'standard', label: 'Standard' },
          { value: 'high', label: 'High Quality' },
          ...($isAndroid ? [] : [{ value: 'anime', label: 'Anime (neural upscale)' }]),
          { value: 'custom', label: 'Custom…' },
        ]} />
        {#if pendingAnime}
          <div class="px-3 py-2.5 text-sm">
            <!-- Size is the real asset size measured against the pinned release (~208 KB today); the
                 download is one-time and cached under the app config dir. -->
            <p class="mb-2">Anime mode needs a shader file (~200 KB) that isn't bundled with the app. Turning it on downloads that file from the internet once, then keeps using the local copy. Download it now?</p>
            <button type="button" data-focusable class="mr-2 rounded bg-primary px-3 py-2 font-bold sm:py-1" onclick={() => answerAnimeConsent(true)}>Download</button>
            <button type="button" data-focusable class="rounded bg-muted px-3 py-2 sm:py-1" onclick={() => answerAnimeConsent(false)}>Cancel</button>
          </div>
        {/if}
        {#if $qualityNotice}
          <p class="px-3 py-2.5 text-sm text-yellow-500">{$qualityNotice}</p>
        {/if}
        {#if $videoQualityPreset === 'custom'}
          <SettingsRow settingKey="custom-mpv-options" title="Custom mpv options" description="One key=value per line. Some options apply from the next video.">
            <textarea
              data-focusable
              aria-label="Custom mpv options"
              class="min-h-32 w-full rounded-md bg-input px-3 py-2.5 font-mono text-base sm:py-2 sm:text-sm"
              placeholder="scale=ewa_lanczossharp&#10;deband=yes&#10;glsl-shaders=C:/path/to/shader.glsl"
              bind:value={$rawMpvOptions}
            ></textarea>
            {#if $qualityFailedKeys.length}
              <p class="mt-1 text-xs text-yellow-500">No live effect (check spelling, or applies next video): {$qualityFailedKeys.join(', ')}</p>
            {/if}
          </SettingsRow>
        {/if}
      </div>
    {/if}

    {#if $isWindows}
      <SettingsChoiceRow settingKey="windows-driver-upscaling" title="Windows driver upscaling" description="Needs a supported NVIDIA or Intel driver." learnMore="Uses mpv's d3d11vpp path on Windows." value={$windowsVsr} onChange={(value) => ($windowsVsr = value as typeof $windowsVsr)} options={[
        { value: 'off', label: 'Off' },
        { value: 'nvidia', label: 'NVIDIA RTX VSR' },
        { value: 'intel', label: 'Intel VSR' },
      ]} />
    {/if}

    {#if !$isAndroid}
      <SettingsChoiceRow settingKey="player-cache-size" title="Player cache size" description="RAM for buffering video. Applies to the next video." learnMore="A baseline that scales up automatically for high-bitrate files, such as a 4K Blu-ray, so they don't rebuffer; normal files stay near the preset. Lower frees memory, higher buffers more. Uncapped buffers the whole file, up to 4 GiB: the most resistant to buffering, with the highest RAM use." value={cacheChoice} onChange={chooseCache} options={cacheOptions} />
      {#if cacheChoice === 'custom'}
        <SettingsRow settingKey="player-cache-custom" title="Custom cache size" description="16 to 4096 MiB.">
          {#snippet control()}
            <input type="number" min="16" max="4096" step="16" bind:value={$playerCacheMb} data-focusable aria-label="Custom cache size" class="w-28 rounded-md bg-input px-3 py-2 text-sm" />
            <span class="text-xs text-muted-foreground">MiB</span>
          {/snippet}
        </SettingsRow>
      {/if}
    {/if}

    {#if $inAppPlayerAvailable}
      <SettingsChoiceRow settingKey="audio-processing" title="Audio processing" description="Dialogue boost, night mode or volume boost. Uses decoded PCM while on." learnMore="Dialogue boost evens out speech. Night mode compresses loud openings. Volume boost raises quiet rips and limits peaks. izumi falls back to decoded PCM output while a filter is active." value={$audioProcessing} onChange={(value) => ($audioProcessing = value as typeof $audioProcessing)} options={[
        { value: 'off', label: 'Off' },
        { value: 'dialogue', label: 'Dialogue boost' },
        { value: 'night', label: 'Night mode' },
        { value: 'boost', label: 'Volume boost' },
      ]} />

      <SettingsRow settingKey="home-theatre-audio" title="Home-theatre audio" description="Atmos and DTS:X pass through to a compatible receiver." learnMore="izumi sends the original carrier to the receiver; it does not render audio objects itself. Recheck probes the outputs again and reopens the video.">
        {#snippet control()}
          <button type="button" data-focusable class="rounded-md bg-secondary px-3 py-1.5 text-xs font-bold hover:bg-accent" onclick={() => void refreshDolbyCapabilities().then(() => applyDolbySettings({ reload: true }))}>Recheck</button>
        {/snippet}
      </SettingsRow>
      <SettingsChoiceRow settingKey="audio-output" title="Audio output" value={$audioOutputMode} onChange={(value) => ($audioOutputMode = value as typeof $audioOutputMode)} options={[
        { value: 'pcm', label: 'Decoded PCM (safe)' },
        { value: 'auto', label: 'Auto-detect receiver' },
        { value: 'optical', label: 'Optical / S/PDIF' },
        { value: 'hdmi', label: 'HDMI / eARC receiver' },
      ]} />
      {#if $audioOutputMode !== 'pcm'}
        <SettingsRow settingKey="dolby-digital" title="Dolby Digital" description="AC-3" onActivate={() => ($audioPassthroughAc3 = !$audioPassthroughAc3)} pressed={$audioPassthroughAc3}>
          {#snippet control()}<SettingsSwitch value={$audioPassthroughAc3} onToggle={() => ($audioPassthroughAc3 = !$audioPassthroughAc3)} label="Dolby Digital" interactive={false} />{/snippet}
        </SettingsRow>
        <SettingsRow settingKey="dolby-digital-plus" title="Dolby Digital Plus" description="E-AC3 / Atmos" onActivate={() => ($audioPassthroughEac3 = !$audioPassthroughEac3)} pressed={$audioPassthroughEac3}>
          {#snippet control()}<SettingsSwitch value={$audioPassthroughEac3} onToggle={() => ($audioPassthroughEac3 = !$audioPassthroughEac3)} label="Dolby Digital Plus" interactive={false} />{/snippet}
        </SettingsRow>
        <SettingsRow settingKey="dolby-truehd" title="Dolby TrueHD" description="TrueHD / Atmos" onActivate={() => ($audioPassthroughTruehd = !$audioPassthroughTruehd)} pressed={$audioPassthroughTruehd}>
          {#snippet control()}<SettingsSwitch value={$audioPassthroughTruehd} onToggle={() => ($audioPassthroughTruehd = !$audioPassthroughTruehd)} label="Dolby TrueHD" interactive={false} />{/snippet}
        </SettingsRow>
        <SettingsRow settingKey="dts" title="DTS" description="DTS core" onActivate={() => ($audioPassthroughDts = !$audioPassthroughDts)} pressed={$audioPassthroughDts}>
          {#snippet control()}<SettingsSwitch value={$audioPassthroughDts} onToggle={() => ($audioPassthroughDts = !$audioPassthroughDts)} label="DTS" interactive={false} />{/snippet}
        </SettingsRow>
        <SettingsRow settingKey="dts-hd-dts-x" title="DTS-HD / DTS:X" description="DTS-HD MA carrier" onActivate={() => ($audioPassthroughDtsHd = !$audioPassthroughDtsHd)} pressed={$audioPassthroughDtsHd}>
          {#snippet control()}<SettingsSwitch value={$audioPassthroughDtsHd} onToggle={() => ($audioPassthroughDtsHd = !$audioPassthroughDtsHd)} label="DTS-HD / DTS:X" interactive={false} />{/snippet}
        </SettingsRow>
        {#if $audioOutputMode === 'optical'}
          <p class="px-3 py-2.5 text-xs text-amber-500">Optical output is restricted to AC-3 and DTS core. E-AC3, TrueHD, DTS-HD MA and object-audio extensions require HDMI/eARC.</p>
        {/if}
        <SettingsRow settingKey="exclusive-audio-device" title="Exclusive audio device" description="Let the player open the output directly where the system allows it." onActivate={() => ($audioExclusive = !$audioExclusive)} pressed={$audioExclusive}>
          {#snippet control()}<SettingsSwitch value={$audioExclusive} onToggle={() => ($audioExclusive = !$audioExclusive)} label="Exclusive audio device" interactive={false} />{/snippet}
        </SettingsRow>
        {#if !$isAndroid}
          <SettingsRow settingKey="mpv-audio-device" title="mpv audio device" description="Pick a detected output or type an mpv device name." learnMore="Detected outputs are listed automatically. A matching HDMI or AVR name is a routing hint, not proof that it accepts every encoded format." controlLayout="stack">
            {#snippet control()}
              <input data-focusable list="home-theatre-audio-devices" aria-label="mpv audio device" class="w-full rounded-md bg-input px-3 py-2 text-sm sm:w-56" bind:value={$audioOutputDevice} placeholder="auto" />
              <datalist id="home-theatre-audio-devices">
                <option value="auto">Operating-system default</option>
                {#each $dolbyCapabilities.audioDevices.filter((device) => device.selectable !== false) as device}<option value={device.id}>{device.name}</option>{/each}
              </datalist>
            {/snippet}
          </SettingsRow>
        {/if}
      {/if}

      <SettingsChoiceRow settingKey="dolby-vision-source-handling" title="Dolby Vision source handling" description="The signal produced from Dolby Vision metadata." learnMore="Auto uses the display hint where gpu-next is available. It is not a claim of certified native Dolby Vision output." ariaLabel="Dolby Vision output target" value={$dolbyVisionOutputMode} onChange={(value) => ($dolbyVisionOutputMode = value as typeof $dolbyVisionOutputMode)} options={[
        { value: 'auto', label: 'Auto display target' },
        { value: 'hdr10', label: 'Convert to HDR10' },
        { value: 'sdr', label: 'Tone-map to SDR' },
      ]} />
    {/if}

    {#if !$isAndroid}
      <SettingsRow settingKey="enable-external-player" title="Enable external player" description="Play in another app, such as mpv or VLC. No progress tracking or resume." onActivate={() => ($enableExternalPlayer = !$enableExternalPlayer)} pressed={$enableExternalPlayer}>
        {#snippet control()}<SettingsSwitch value={$enableExternalPlayer} onToggle={() => ($enableExternalPlayer = !$enableExternalPlayer)} label="Enable external player" interactive={false} />{/snippet}
      </SettingsRow>
      {#if $enableExternalPlayer}
        <SettingsRow settingKey="external-video-player" title="External video player" description="The player's executable. The stream URL is its only argument." controlLayout="stack">
          {#snippet control()}
            <input type="text" data-focusable aria-label="External video player" bind:value={$externalPlayerPath} placeholder="C:\Program Files\mpv\mpv.exe" class="min-w-0 flex-1 rounded-md bg-input px-3 py-2 text-sm sm:w-64" />
            <button type="button" data-focusable onclick={browsePlayer} class="shrink-0 rounded-md bg-secondary px-4 py-2 text-sm font-bold transition-colors hover:bg-accent">Browse…</button>
          {/snippet}
        </SettingsRow>
      {/if}
      <SettingsRow settingKey="animate-player-progress-controls" title="Animate player progress controls" description="Animates the Game-mode progress bar and controls. Off shows them instantly." onActivate={() => ($playerProgressAnimations = !$playerProgressAnimations)} pressed={$playerProgressAnimations}>
        {#snippet control()}<SettingsSwitch value={$playerProgressAnimations} onToggle={() => ($playerProgressAnimations = !$playerProgressAnimations)} label="Animate player progress controls" interactive={false} />{/snippet}
      </SettingsRow>
      <SettingsRow settingKey="subtitle-line-navigation" title="Subtitle line navigation" description="Previous, Replay and Next subtitle-line buttons in the player." learnMore="Useful for language learning. Off by default." onActivate={() => ($subtitleLineNavigation = !$subtitleLineNavigation)} pressed={$subtitleLineNavigation}>
        {#snippet control()}<SettingsSwitch value={$subtitleLineNavigation} onToggle={() => ($subtitleLineNavigation = !$subtitleLineNavigation)} label="Subtitle line navigation" interactive={false} />{/snippet}
      </SettingsRow>
      <SettingsRow settingKey="title-at-top-of-player-game-mode" title="Title at top of player (Game mode)" description="On the Deck, the title sits at the top instead of above the seek bar." onActivate={() => ($playerTitleTop = !$playerTitleTop)} pressed={$playerTitleTop}>
        {#snippet control()}<SettingsSwitch value={$playerTitleTop} onToggle={() => ($playerTitleTop = !$playerTitleTop)} label="Title at top of player (Game mode)" interactive={false} />{/snippet}
      </SettingsRow>
    {/if}

    <SettingsChoiceRow settingKey="adaptive-source-planner" title="Adaptive source planner" description={PLANNER_NOTES[$adaptiveSourceMode]} learnMore="Outcomes stay on this device and are cleared with local history. The planner never overrides cache, quality, audio language or your source order. On adapts automatic choices and bounded recovery: a bad route can trigger another route, and wrong content always triggers another release. Preview only shows a safer first source; it does not change what Auto plays." value={$adaptiveSourceMode} onChange={(value) => ($adaptiveSourceMode = value as typeof $adaptiveSourceMode)} options={[
      { value: 'active', label: 'On — adapt automatic choices' },
      { value: 'shadow', label: 'Preview — learn without changing playback' },
      { value: 'off', label: 'Off' },
    ]} />
    <SettingsRow settingKey="mark-best-releases" title="Mark best releases" description="Badges the curated best release and lists it first at its resolution." learnMore="Checks a community-curated release list for the release its curators rate best for each title. It never picks a lower resolution than you would have got without it, and adds no source: it only annotates what your sources already found." onActivate={() => ($seadexAnnotations = !$seadexAnnotations)} pressed={$seadexAnnotations}>
      {#snippet control()}<SettingsSwitch value={$seadexAnnotations} onToggle={() => ($seadexAnnotations = !$seadexAnnotations)} label="Mark best releases" interactive={false} />{/snippet}
    </SettingsRow>

    {#if $developerLogging && $inAppPlayerAvailable}
    <section aria-label="Home-theatre capability diagnostics" class="bg-secondary/35 px-3 py-2.5 text-xs">
      <div class="flex items-center justify-between gap-3">
        <h4 class="text-sm font-bold">Home-theatre capability diagnostics</h4>
        <span class="rounded bg-background px-2 py-1 font-mono">{$dolbyCapabilities.engine}</span>
      </div>
      <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        <span class="text-muted-foreground">mpv</span><span class="col-span-1 truncate font-mono sm:col-span-2">{$dolbyCapabilities.mpvVersion || 'not running'}</span>
        <span class="text-muted-foreground">FFmpeg / libplacebo</span><span class="col-span-1 break-words font-mono sm:col-span-2">{$dolbyCapabilities.ffmpegVersion || 'unknown'} / {$dolbyCapabilities.libplaceboVersion || 'unknown'}</span>
        <span class="text-muted-foreground">Audio output</span><span class="col-span-1 font-mono sm:col-span-2">{audioOutput}</span>
        <span class="text-muted-foreground">Video output</span><span class="col-span-1 font-mono sm:col-span-2">{videoOutput}</span>
        <span class="text-muted-foreground">Source / target colour</span><span class="col-span-1 font-mono sm:col-span-2">{$dolbyCapabilities.current.videoPrimaries || '?'} / {$dolbyCapabilities.current.videoTransfer || '?'} → {$dolbyCapabilities.current.videoTargetPrimaries || '?'} / {$dolbyCapabilities.current.videoTargetTransfer || '?'}</span>
        <span class="text-muted-foreground">DV source profile</span><span class="col-span-1 font-mono sm:col-span-2">{$dolbyCapabilities.current.dolbyVisionProfile || 'unknown'} · level {$dolbyCapabilities.current.dolbyVisionLevel || 'unknown'}{#if $dolbyCapabilities.current.dolbyVisionProfile === '7'} · MEL/FEL not determined{/if}</span>
        <span class="text-muted-foreground">Route probe</span><span class="col-span-1 font-mono sm:col-span-2">{$dolbyCapabilities.audioConfidence}</span>
        <span class="text-muted-foreground">Atmos formats</span><span class="col-span-1 font-mono sm:col-span-2">E-AC3 JOC {$dolbyCapabilities.audio.eac3Joc ? 'yes' : 'no'} · TrueHD {$dolbyCapabilities.audio.truehd ? 'yes' : 'no'} · MAT {$dolbyCapabilities.audio.mat ? 'yes' : 'no'}</span>
        <span class="text-muted-foreground">DTS formats</span><span class="col-span-1 font-mono sm:col-span-2">core {$dolbyCapabilities.audio.dts ? 'yes' : 'no'} · HD {$dolbyCapabilities.audio.dtsHd ? 'yes' : 'no'} · MA {$dolbyCapabilities.audio.dtsHdMa ? 'yes' : 'no'} · X/UHD {$dolbyCapabilities.audio.dtsX ? 'yes' : 'no'}</span>
        <span class="text-muted-foreground">Dolby Vision</span><span class="col-span-1 font-mono sm:col-span-2">display {$dolbyCapabilities.video.dolbyVisionDisplay ? 'yes' : 'no'} · decoder {$dolbyCapabilities.video.dolbyVisionDecoder ? 'yes' : 'no'} · native path {$dolbyCapabilities.video.dolbyVisionNativePath ? 'yes' : 'no'}</span>
        <span class="text-muted-foreground">Android HDR</span><span class="col-span-1 font-mono sm:col-span-2">HDR10+ {$dolbyCapabilities.video.hdr10PlusDisplay ? 'yes' : 'no'} / native {$dolbyCapabilities.video.hdr10PlusNativePath ? 'yes' : 'no'} · HLG {$dolbyCapabilities.video.hlgDisplay ? 'yes' : 'no'} / native {$dolbyCapabilities.video.hlgNativePath ? 'yes' : 'no'}</span>
        <span class="text-muted-foreground">10-bit decoders</span><span class="col-span-1 font-mono sm:col-span-2">HEVC {$dolbyCapabilities.codecs.hevcMain10 ? 'yes' : 'no'} · AV1 {$dolbyCapabilities.codecs.av1Main10 ? 'yes' : 'no'} · VP9 P2 {$dolbyCapabilities.codecs.vp9Profile2 ? 'yes' : 'no'}</span>
        <span class="text-muted-foreground">DV profiles</span><span class="col-span-1 font-mono sm:col-span-2">{$dolbyCapabilities.codecs.dolbyVisionProfiles.join(', ') || 'none reported'}</span>
        <span class="text-muted-foreground">Current codec</span><span class="col-span-1 font-mono sm:col-span-2">{$dolbyCapabilities.codecs.currentCodecString || 'not available'} · {$dolbyCapabilities.codecs.currentSupported == null ? 'not checked' : $dolbyCapabilities.codecs.currentSupported ? 'supported' : 'unsupported'}</span>
        <span class="text-muted-foreground">DRM path</span><span class="col-span-1 font-mono sm:col-span-2">DV {$drmDolbyStatus.dolbyVision} · Atmos carrier {$drmDolbyStatus.atmos}{$drmDolbyStatus.fallbackApplied ? ' · fallback active' : ''}</span>
      </div>
      {#each $dolbyCapabilities.displays as display}
        <p class="mt-1 font-mono text-muted-foreground">{display.name} · {display.connection} · HDR {display.hdrSupported == null ? 'unknown' : display.hdrSupported ? 'supported' : 'no'}{display.hdrEnabled == null ? '' : display.hdrEnabled ? ' / enabled' : ' / disabled'}{display.bitsPerColor ? ` · ${display.bitsPerColor}-bit` : ''}</p>
      {/each}
      {#if $dolbyCapabilities.audioDevices.length}
        <p class="mt-1 font-mono text-muted-foreground">Outputs: {$dolbyCapabilities.audioDevices.map((device) => device.name).join(' · ')}</p>
      {/if}
      {#if $dolbyCapabilityError}<p class="mt-2 text-amber-500">Probe unavailable: {$dolbyCapabilityError}</p>{/if}
      {#each $dolbyCapabilities.limitations as limitation}
        <p class="mt-1 text-muted-foreground">• {limitation}</p>
      {/each}
    </section>
    {/if}
  </SettingsSubcategory>
</SettingsSection>
