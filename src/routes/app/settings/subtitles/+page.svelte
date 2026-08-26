<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import {
    subtitleProviders,
    openSubtitlesToken,
    openSubtitlesExpiry,
    openSubtitlesUserName,
    openSubtitlesBaseUrl,
    openSubtitlesStaySignedIn,
    openSubtitlesCreds,
    subDlApiKey,
    jimakuApiKey,
    subtitleStyleEnabled,
    subtitleOverrideScope,
    subtitleFont,
    subtitleBold,
    subtitleFontSize,
    subtitleTextColor,
    subtitleBorderColor,
    subtitleBorderSize,
    subtitleShadow,
    subtitlePosition,
    subtitleAutoSync,
    secondarySubtitles,
    subtitleStripSdh,
    subtitleStripSdhHarder,
    subtitleRegexFilter,
  } from '$lib/settings/ui'
  import SettingsGroup from '$lib/components/settings/SettingsGroup.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import SubtitleProviderBadge from '$lib/components/settings/SubtitleProviderBadge.svelte'
  import Palette from '@lucide/svelte/icons/palette'
  import Bookmark from '@lucide/svelte/icons/bookmark'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Languages from '@lucide/svelte/icons/languages'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Check from '@lucide/svelte/icons/check'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import { isAndroid } from '$lib/platform'
  import { ripple } from '$lib/actions/ripple'
  import { savedSubtitleStyles, applyPresetGlobally, deleteSubtitlePreset, saveSubtitlePreset, type SubtitleStylePreset } from '$lib/settings/subtitle-presets'

  // Saved fonting presets (captured in the player). Applying one writes the appearance stores
  // above — from then on the sliders edit it like any hand-made style. Renames re-save under the
  // new name via the same replace-by-name path the player uses.
  let renamingId = $state<string | null>(null)
  let renameText = $state('')
  function applyPreset(preset: SubtitleStylePreset) {
    applyPresetGlobally(preset)
  }
  function startRename(preset: SubtitleStylePreset) {
    renamingId = preset.id
    renameText = preset.name
  }
  function commitRename(preset: SubtitleStylePreset) {
    const name = renameText.trim()
    if (name && name.toLowerCase() !== preset.name.toLowerCase()) {
      deleteSubtitlePreset(preset.id)
      saveSubtitlePreset(name, preset.style, preset.source)
    }
    renamingId = null
  }

  // Font names libass can actually resolve. Nunito travels with the app on every platform (the
  // Android player registers it through the plugin's bundled fonts directory); the rest are the
  // families that are present on essentially every Android device, so a pick here renders rather
  // than silently falling back. Desktop additionally resolves any installed system font, which is
  // why this stays a free-text field with suggestions instead of a closed dropdown.
  const FONT_SUGGESTIONS = ['Nunito', 'Roboto', 'Noto Sans', 'Noto Serif', 'Noto Sans Mono', 'sans-serif']
  const DIALOGUE_TYPEFACES = [
    { font: 'Nunito', label: 'Nunito Bold', note: 'Soft and readable' },
    { font: 'Noto Sans', label: 'Noto Sans Bold', note: 'Broad script support' },
    { font: 'Roboto', label: 'Roboto Bold', note: 'Compact and familiar' },
  ]

  function applyDialogueTypeface(font: string) {
    $subtitleFont = font
    $subtitleBold = true
    $subtitleOverrideScope = 'dialogue'
    $subtitleStyleEnabled = true
  }
  const quickTypeface = $derived(
    $subtitleBold && DIALOGUE_TYPEFACES.some((typeface) => typeface.font === $subtitleFont)
      ? $subtitleFont
      : 'custom',
  )
  let hoveredTypeface = $state<string | null>(null)
  const selectedTypeface = $derived(quickTypeface === 'custom' ? $subtitleFont : quickTypeface)
  const previewTypeface = $derived(hoveredTypeface ?? selectedTypeface)
  const previewTypefaceLabel = $derived(
    DIALOGUE_TYPEFACES.find((typeface) => typeface.font === previewTypeface)?.label ?? previewTypeface,
  )
  let fineTuningOpen = $state(false)

  // Shape returned by the Rust `opensubtitles_login` command.
  type OpenSubtitlesLogin = {
    token: string
    base_url: string
    allowed_downloads: number
    remaining: number
    level: string
    expires_at: number
  }

  function hasProvider(id: string) {
    return $subtitleProviders.includes(id)
  }
  function toggleProvider(id: string) {
    const enabling = !hasProvider(id)
    $subtitleProviders = enabling
      ? [...$subtitleProviders, id]
      : $subtitleProviders.filter((p) => p !== id)
  }

  // OpenSubtitles account (username/password → JWT via Rust). The password never
  // touches a persisted store unless "Stay signed in" is on (see connect()).
  let osUser = $state('')
  let osPass = $state('')
  let osStay = $state($openSubtitlesStaySignedIn)
  let osBusy = $state(false)
  let osError = $state('')
  // Quota from the last login this session (allowance 0 = hide the pill). The
  // post-download refresh lives in the player slice, not here.
  let osRemaining = $state(0)
  let osAllowed = $state(0)

  async function connectOpenSubtitles() {
    osError = ''
    osBusy = true
    try {
      const username = osUser.trim()
      const password = osPass
      const res = await invoke<OpenSubtitlesLogin>('opensubtitles_login', { username, password })
      $openSubtitlesToken = res.token
      $openSubtitlesBaseUrl = res.base_url
      $openSubtitlesExpiry = res.expires_at
      $openSubtitlesUserName = username
      $openSubtitlesStaySignedIn = osStay
      $openSubtitlesCreds = osStay ? JSON.stringify({ username, password }) : ''
      osRemaining = res.remaining
      osAllowed = res.allowed_downloads
      osPass = ''
    } catch (e) {
      osError = e instanceof Error ? e.message : String(e)
    } finally {
      osBusy = false
    }
  }

  function disconnectOpenSubtitles() {
    $openSubtitlesToken = ''
    $openSubtitlesCreds = ''
    $openSubtitlesExpiry = 0
    $openSubtitlesUserName = ''
    $openSubtitlesBaseUrl = ''
    osUser = ''
    osPass = ''
    osRemaining = 0
    osAllowed = 0
  }
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Subtitles</h2>
  <p class="mb-4 max-w-2xl text-sm text-muted-foreground">Subtitle sources, appearance, and playback behaviour.</p>

  {#snippet openSubtitlesBadge()}<SubtitleProviderBadge provider="opensubtitles" />{/snippet}
  {#snippet openSubtitlesMeta()}
    <span class="inline-flex items-center gap-1.5">
      <span class="size-1.5 rounded-full {hasProvider('opensubtitles') ? 'bg-emerald-400' : 'bg-white/25'}"></span>
      {#if !hasProvider('opensubtitles')}Off
      {:else if $openSubtitlesToken && $openSubtitlesUserName}Connected as {$openSubtitlesUserName}
      {:else}Search ready · sign in to download{/if}
    </span>
  {/snippet}
  {#snippet openSubtitlesControl()}
    <SettingsSwitch interactive={false} label="Enable OpenSubtitles" value={hasProvider('opensubtitles')} onToggle={() => toggleProvider('opensubtitles')} />
  {/snippet}
  {#snippet subDlBadge()}<SubtitleProviderBadge provider="subdl" />{/snippet}
  {#snippet subDlMeta()}
    <span class="inline-flex items-center gap-1.5">
      <span class="size-1.5 rounded-full {!hasProvider('subdl') ? 'bg-white/25' : $subDlApiKey.trim() ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
      {!hasProvider('subdl') ? 'Off' : $subDlApiKey.trim() ? 'Ready · API key saved' : 'API key required'}
    </span>
  {/snippet}
  {#snippet subDlControl()}
    <SettingsSwitch interactive={false} label="Enable SubDL" value={hasProvider('subdl')} onToggle={() => toggleProvider('subdl')} />
  {/snippet}
  {#snippet jimakuBadge()}<SubtitleProviderBadge provider="jimaku" />{/snippet}
  {#snippet jimakuMeta()}
    <span class="inline-flex items-center gap-1.5">
      <span class="size-1.5 rounded-full {!hasProvider('jimaku') ? 'bg-white/25' : $jimakuApiKey.trim() ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
      {!hasProvider('jimaku') ? 'Off' : $jimakuApiKey.trim() ? 'Ready · API key saved' : 'API key required'}
    </span>
  {/snippet}
  {#snippet jimakuControl()}
    <SettingsSwitch interactive={false} label="Enable Jimaku" value={hasProvider('jimaku')} onToggle={() => toggleProvider('jimaku')} />
  {/snippet}

  <SettingsGroup icon={Languages} title="Providers" desc="Enable a source and configure it in the same row.">
    <SettingsRow settingKey="opensubtitles" title="OpenSubtitles" leading={openSubtitlesBadge} meta={openSubtitlesMeta} control={openSubtitlesControl} expanded={hasProvider('opensubtitles')} onActivate={() => toggleProvider('opensubtitles')} pressed={hasProvider('opensubtitles')}>
      {#if $openSubtitlesToken && $openSubtitlesUserName}
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs text-muted-foreground">
            Downloads enabled{osAllowed > 0 ? ` · ${osRemaining}/${osAllowed} remaining today` : ''}.
          </p>
          <button type="button" data-focusable onclick={disconnectOpenSubtitles} class="shrink-0 rounded-md px-3 py-2 text-xs font-bold text-destructive hover:bg-destructive/10">Disconnect</button>
        </div>
      {:else}
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs text-muted-foreground">Search works without an account. Sign in only to download a result.</p>
          <a href="https://www.opensubtitles.com/en/users/sign_up" target="_blank" rel="noopener noreferrer" data-focusable class="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-bold text-theme hover:bg-secondary hover:underline">
            Create account <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <input type="text" bind:value={osUser} data-focusable autocomplete="username" placeholder="Username" aria-label="OpenSubtitles username" class="h-10 rounded-md bg-input px-3 text-sm" />
          <input type="password" bind:value={osPass} data-focusable autocomplete="current-password" placeholder="Password" aria-label="OpenSubtitles password" class="h-10 rounded-md bg-input px-3 text-sm" />
        </div>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
          <label class="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" bind:checked={osStay} data-focusable class="size-4" />
            Stay signed in on this device
          </label>
          <button type="button" onclick={connectOpenSubtitles} data-focusable disabled={osBusy || !osUser.trim() || !osPass} class="rounded-md bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-40">
            {osBusy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
        {#if osError}<p class="mt-2 text-xs text-destructive">{osError}</p>{/if}
      {/if}
    </SettingsRow>

    <SettingsRow settingKey="subdl" title="SubDL" leading={subDlBadge} meta={subDlMeta} control={subDlControl} expanded={hasProvider('subdl')} onActivate={() => toggleProvider('subdl')} pressed={hasProvider('subdl')}>
      <div>
        <div class="mb-1 flex items-center justify-between gap-2">
          <label for="subdl-api-key" class="text-xs font-bold">API key</label>
          <a href="https://subdl.com/panel/api" target="_blank" rel="noopener noreferrer" data-focusable class="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-bold text-theme hover:bg-secondary hover:underline">
            Get API key <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
        <input id="subdl-api-key" type="password" bind:value={$subDlApiKey} data-focusable autocomplete="off" placeholder="Paste SubDL API key" class="h-10 w-full rounded-md bg-input px-3 text-sm" />
        <span class="mt-1 block text-[11px] text-muted-foreground">Saved on this device. SubDL is skipped until a key is present.</span>
      </div>
    </SettingsRow>

    <SettingsRow settingKey="jimaku" title="Jimaku" leading={jimakuBadge} meta={jimakuMeta} control={jimakuControl} expanded={hasProvider('jimaku')} onActivate={() => toggleProvider('jimaku')} pressed={hasProvider('jimaku')}>
      <div>
        <div class="mb-1 flex items-center justify-between gap-2">
          <label for="jimaku-api-key" class="text-xs font-bold">API key</label>
          <a href="https://jimaku.cc/account" target="_blank" rel="noopener noreferrer" data-focusable class="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-bold text-theme hover:bg-secondary hover:underline">
            Get API key <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
        <input id="jimaku-api-key" type="password" bind:value={$jimakuApiKey} data-focusable autocomplete="off" placeholder="Paste Jimaku API key" class="h-10 w-full rounded-md bg-input px-3 text-sm" />
        <span class="mt-1 block text-[11px] text-muted-foreground">Saved on this device. Jimaku is skipped until a key is present.</span>
      </div>
    </SettingsRow>
  </SettingsGroup>

  {#snippet styleMeta()}
    {$subtitleStyleEnabled ? `${$subtitleFont}${$subtitleBold ? ' Bold' : ''} · ${$subtitleOverrideScope === 'dialogue' ? 'dialogue only' : 'all elements'}` : 'Use each subtitle track’s original styling'}
  {/snippet}
  {#snippet styleControl()}
    <SettingsSwitch interactive={false} label="Use custom subtitle style" value={$subtitleStyleEnabled} onToggle={() => ($subtitleStyleEnabled = !$subtitleStyleEnabled)} />
  {/snippet}
  {#snippet scopeControl()}
    <SelectMenu className="w-full sm:w-36" value={$subtitleOverrideScope} onChange={(value) => ($subtitleOverrideScope = value as typeof $subtitleOverrideScope)} ariaLabel="Subtitle style scope" options={[
      { value: 'dialogue', label: 'Dialogue only' },
      { value: 'all', label: 'All elements' },
    ]} />
  {/snippet}
  {#snippet fineTuningControl()}
    <span class="grid size-8 place-items-center text-muted-foreground" aria-hidden="true">
      <ChevronDown size={16} class="transition-transform {fineTuningOpen ? 'rotate-180' : ''}" />
    </span>
  {/snippet}

  {#snippet typefacePreview()}
    <div class="flex min-h-40 items-center justify-center overflow-hidden rounded-xl border border-border bg-black/55 px-5 py-6 text-center lg:min-h-[22rem]">
      <div class="min-w-0">
        <p class="truncate text-[10px] font-bold uppercase tracking-widest text-white/45">Preview · {previewTypefaceLabel}</p>
        <div
          class="mt-5 text-2xl font-bold leading-snug xl:text-3xl"
          style:font-family={previewTypeface}
          style:color={$subtitleTextColor}
          style:-webkit-text-stroke={`${Math.min(1.5, Number($subtitleBorderSize) * 0.35)}px ${$subtitleBorderColor}`}
          style:text-shadow={`0 ${Math.min(2, Number($subtitleShadow) * 0.4)}px ${Math.min(4, Number($subtitleShadow) * 0.8)}px ${$subtitleBorderColor}`}
        >
          <span class="block">The moon is beautiful tonight.</span>
          <span class="mt-2 block text-[0.78em]">字幕を読みやすく。</span>
        </div>
      </div>
    </div>
  {/snippet}

  <div class="lg:grid lg:grid-cols-[minmax(0,42rem)_minmax(18rem,1fr)] lg:items-start lg:gap-6">
    <div class="min-w-0">

  <SettingsGroup icon={Palette} title="Appearance">
    <SettingsRow settingKey="use-custom-subtitle-style" title="Custom subtitle style" meta={styleMeta} control={styleControl} onActivate={() => ($subtitleStyleEnabled = !$subtitleStyleEnabled)} pressed={$subtitleStyleEnabled} />

    {#if $subtitleStyleEnabled}
      <SettingsRow settingKey="subtitle-dialogue-style-overrides" title="Apply style to" description={$subtitleOverrideScope === 'dialogue' ? 'Preserves signs and positioned text where mpv can identify them.' : 'Forces one style over signs, songs, and other typesetting.'} control={scopeControl} controlLayout="stack" />

      <SettingsRow title="Typeface" description="Hover or focus a face to preview it; tap anywhere on a choice to apply it.">
        <div class="grid gap-1.5 sm:grid-cols-3" role="group" aria-label="Dialogue typeface">
            {#each DIALOGUE_TYPEFACES as typeface (typeface.font)}
              {@const selected = quickTypeface === typeface.font}
              <button
                type="button"
                data-focusable
                aria-pressed={selected}
                use:ripple
                onclick={() => applyDialogueTypeface(typeface.font)}
                onpointerenter={() => (hoveredTypeface = typeface.font)}
                onpointerleave={() => (hoveredTypeface = null)}
                onfocus={() => (hoveredTypeface = typeface.font)}
                onblur={() => (hoveredTypeface = null)}
                class="ripple-host flex min-h-16 w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors
                  {selected ? 'border-primary/60 bg-primary/10' : 'border-border bg-background/35 hover:border-primary/35 hover:bg-secondary/70'}"
              >
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-bold">{typeface.label}</span>
                  <span class="block truncate text-[11px] text-muted-foreground">{typeface.note}</span>
                </span>
                <span class="text-lg font-bold text-muted-foreground" style:font-family={typeface.font} aria-hidden="true">Aa</span>
                <span class="grid size-5 shrink-0 place-items-center rounded-full border {selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'}" aria-hidden="true">
                  {#if selected}<Check size={12} strokeWidth={3} />{/if}
                </span>
              </button>
            {/each}
        </div>
        <div class="mt-3 lg:hidden">{@render typefacePreview()}</div>
      </SettingsRow>

      <SettingsRow title="Fine tuning" description="Font, weight, colours, outline, shadow, and position." control={fineTuningControl} expanded={fineTuningOpen} onActivate={() => (fineTuningOpen = !fineTuningOpen)}>
        <div class="space-y-3">
          <button
            type="button"
            data-focusable
            use:ripple
            aria-pressed={$subtitleBold}
            onclick={() => ($subtitleBold = !$subtitleBold)}
            class="ripple-host flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left transition-colors active:bg-secondary sm:hover:bg-secondary/70"
          >
            <span class="text-xs font-bold">Bold dialogue</span>
            <SettingsSwitch interactive={false} label="Bold dialogue" value={$subtitleBold} onToggle={() => ($subtitleBold = !$subtitleBold)} />
          </button>
          <label class="block">
            <span class="mb-1 block text-xs font-bold">Font family</span>
            <input type="text" list="subtitle-font-suggestions" bind:value={$subtitleFont} data-focusable class="h-10 w-full rounded-md bg-input px-3 text-sm" />
            <datalist id="subtitle-font-suggestions">
              {#each FONT_SUGGESTIONS as font (font)}<option value={font}></option>{/each}
            </datalist>
            <span class="mt-1 block text-[11px] text-muted-foreground">{$isAndroid ? 'Nunito is bundled; missing device fonts fall back automatically.' : 'Any installed font, plus bundled Nunito.'}</span>
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label><span class="mb-1 block text-xs font-bold">Text</span><input type="color" bind:value={$subtitleTextColor} data-focusable class="h-9 w-full rounded-md bg-input p-1" /></label>
            <label><span class="mb-1 block text-xs font-bold">Outline</span><input type="color" bind:value={$subtitleBorderColor} data-focusable class="h-9 w-full rounded-md bg-input p-1" /></label>
          </div>
          <div class="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <label class="text-xs"><span class="flex justify-between font-bold"><span>Size</span><span>{$subtitleFontSize}px</span></span><input type="range" min="20" max="80" step="1" bind:value={$subtitleFontSize} data-focusable class="h-7 w-full accent-primary" /></label>
            <label class="text-xs"><span class="flex justify-between font-bold"><span>Outline</span><span>{$subtitleBorderSize}px</span></span><input type="range" min="0" max="8" step="0.5" bind:value={$subtitleBorderSize} data-focusable class="h-7 w-full accent-primary" /></label>
            <label class="text-xs"><span class="flex justify-between font-bold"><span>Shadow</span><span>{$subtitleShadow}px</span></span><input type="range" min="0" max="8" step="0.5" bind:value={$subtitleShadow} data-focusable class="h-7 w-full accent-primary" /></label>
            <label class="text-xs"><span class="flex justify-between font-bold"><span>Position</span><span>{$subtitlePosition}%</span></span><input type="range" min="10" max="100" step="1" bind:value={$subtitlePosition} data-focusable class="h-7 w-full accent-primary" /></label>
          </div>
        </div>
      </SettingsRow>
    {/if}
  </SettingsGroup>

  <SettingsGroup icon={Bookmark} title="Saved styles">
    {#if $savedSubtitleStyles.length}
      {#each $savedSubtitleStyles as preset (preset.id)}
        <div class="px-3 py-2.5">
          <div class="flex min-h-9 flex-wrap items-center gap-2">
            <span class="min-w-0 flex-1 basis-full sm:basis-40">
              <span class="block truncate text-sm font-bold">{preset.name}</span>
              <span class="block truncate text-[11px] text-muted-foreground">{preset.style.font}{preset.style.bold ? ' Bold' : ''}{preset.source?.title ? ` · ${preset.source.title}` : ''}</span>
            </span>
            {#if renamingId !== preset.id}
              <button type="button" onclick={() => applyPreset(preset)} data-focusable class="rounded-md bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground">Apply</button>
              <button type="button" onclick={() => startRename(preset)} data-focusable class="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">Rename</button>
              <button type="button" onclick={() => deleteSubtitlePreset(preset.id)} data-focusable aria-label={`Delete ${preset.name}`} class="rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10">Delete</button>
            {/if}
          </div>
          {#if renamingId === preset.id}
          <div class="mt-2 flex items-center gap-2">
            <input bind:value={renameText} data-focusable aria-label="Style name" class="h-9 min-w-0 flex-1 rounded-md bg-input px-3 text-sm" onkeydown={(e) => { if (e.key === 'Enter') commitRename(preset); else if (e.key === 'Escape') renamingId = null }} />
            <button type="button" onclick={() => commitRename(preset)} data-focusable class="rounded-md bg-primary px-3 py-2 text-xs font-bold text-primary-foreground">Done</button>
          </div>
          {/if}
        </div>
      {/each}
    {:else}
      <SettingsRow title="No saved styles" description="Save a release’s subtitle style from the player to reuse it here." />
    {/if}
  </SettingsGroup>

  <!-- Speech-analysis sync shells out to a local ffmpeg, which Android has no path to — the toggle
       was a control that could never do anything there. -->
  {#if !$isAndroid}
    {#snippet autoSyncControl()}<SettingsSwitch interactive={false} label="Automatically sync external subtitles" value={$subtitleAutoSync} onToggle={() => ($subtitleAutoSync = !$subtitleAutoSync)} />{/snippet}
    {#snippet dualControl()}<SettingsSwitch interactive={false} label="Dual subtitles" value={$secondarySubtitles} onToggle={() => ($secondarySubtitles = !$secondarySubtitles)} />{/snippet}
    {#snippet sdhControl()}<SettingsSwitch interactive={false} label="Remove SDH annotations" value={$subtitleStripSdh} onToggle={() => ($subtitleStripSdh = !$subtitleStripSdh)} />{/snippet}
    {#snippet strongerSdhControl()}<SettingsSwitch interactive={false} label="Stronger SDH removal" value={$subtitleStripSdhHarder} onToggle={() => ($subtitleStripSdhHarder = !$subtitleStripSdhHarder)} />{/snippet}
    {#snippet regexControl()}
      <input type="text" bind:value={$subtitleRegexFilter} data-focusable aria-label="Subtitle text filter" placeholder="Optional regex" class="h-9 w-36 rounded-md bg-input px-3 text-sm sm:w-48" />
    {/snippet}

    <SettingsGroup icon={RefreshCw} title="Playback & cleanup">
      <SettingsRow title="Automatic sync" description="Align external text subtitles using local speech analysis." control={autoSyncControl} onActivate={() => ($subtitleAutoSync = !$subtitleAutoSync)} pressed={$subtitleAutoSync} />

      <SettingsRow title="Dual subtitles" description="Show a second subtitle-track picker for language learning." control={dualControl} onActivate={() => ($secondarySubtitles = !$secondarySubtitles)} pressed={$secondarySubtitles} />

      <SettingsRow title="Remove SDH annotations" description="Hide speaker labels and sound descriptions." control={sdhControl} onActivate={() => ($subtitleStripSdh = !$subtitleStripSdh)} pressed={$subtitleStripSdh} />

      {#if $subtitleStripSdh}
        <SettingsRow title="Stronger cleanup" description="Catches more annotations but can remove intentional text." control={strongerSdhControl} onActivate={() => ($subtitleStripSdhHarder = !$subtitleStripSdhHarder)} pressed={$subtitleStripSdhHarder} />
      {/if}

      <SettingsRow title="Text filter" description="Hide lines matching an mpv regular expression." control={regexControl} />
    </SettingsGroup>
  {/if}

    </div>

    {#if $subtitleStyleEnabled}
      <aside class="sticky top-8 hidden min-w-0 lg:block" aria-label="Typeface preview">
        <div class="mb-2 px-1">
          <h3 class="text-sm font-black">Typeface preview</h3>
          <p class="text-[11px] leading-4 text-muted-foreground">Hover or focus a typeface to compare it here.</p>
        </div>
        {@render typefacePreview()}
      </aside>
    {/if}
  </div>

</div>
