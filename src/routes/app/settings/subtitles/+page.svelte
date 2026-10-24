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
  import CredentialField from '$lib/components/settings/CredentialField.svelte'
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsChoiceRow from '$lib/components/settings/SettingsChoiceRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import SetupElsewhere from '$lib/components/settings/SetupElsewhere.svelte'
  import SubtitleProviderBadge from '$lib/components/settings/SubtitleProviderBadge.svelte'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import { isAndroid } from '$lib/platform'
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
  const typefaceOptions = [
    ...DIALOGUE_TYPEFACES.map((typeface) => ({ value: typeface.font, label: typeface.label, description: typeface.note })),
    { value: 'custom', label: 'Custom', description: 'Set in Advanced' },
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
  const previewTypeface = $derived(quickTypeface === 'custom' ? $subtitleFont : quickTypeface)
  const previewTypefaceLabel = $derived(
    DIALOGUE_TYPEFACES.find((typeface) => typeface.font === previewTypeface)?.label ?? previewTypeface,
  )
  const styleSummary = $derived($subtitleStyleEnabled
    ? `${$subtitleFont}${$subtitleBold ? ' Bold' : ''} · ${$subtitleOverrideScope === 'dialogue' ? 'dialogue only' : 'all elements'}`
    : 'Use each subtitle track’s original styling')

  // Shape returned by the Rust `opensubtitles_login` command.
  type OpenSubtitlesLogin = {
    token: string
    base_url: string
    allowed_downloads: number
    remaining: number
    level: string
    expires_at: number
  }

  let expandedProvider = $state<string | null>(null)
  function toggleProviderDetails(id: string) { expandedProvider = expandedProvider === id ? null : id }
  function hasProvider(id: string) {
    return $subtitleProviders.includes(id)
  }
  function toggleProvider(id: string) {
    const enabling = !hasProvider(id)
    $subtitleProviders = enabling
      ? [...$subtitleProviders, id]
      : $subtitleProviders.filter((p) => p !== id)
    if (enabling && !(id === 'subdl' ? $subDlApiKey : id === 'jimaku' ? $jimakuApiKey : $openSubtitlesToken)) expandedProvider = id
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
  <button type="button" data-focusable aria-expanded={expandedProvider === 'opensubtitles'} onclick={() => toggleProviderDetails('opensubtitles')} class="min-h-10 rounded-lg bg-secondary px-3 text-xs font-semibold">{$openSubtitlesToken ? 'Manage' : 'Sign in'}</button>
  <SettingsSwitch label="Enable OpenSubtitles" value={hasProvider('opensubtitles')} onToggle={() => toggleProvider('opensubtitles')} />
{/snippet}
{#snippet subDlBadge()}<SubtitleProviderBadge provider="subdl" />{/snippet}
{#snippet subDlMeta()}
  <span class="inline-flex items-center gap-1.5">
    <span class="size-1.5 rounded-full {!hasProvider('subdl') ? 'bg-white/25' : $subDlApiKey.trim() ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
    {!hasProvider('subdl') ? 'Off' : $subDlApiKey.trim() ? 'Ready · API key saved' : 'API key required'}
  </span>
{/snippet}
{#snippet subDlControl()}
  <button type="button" data-focusable aria-expanded={expandedProvider === 'subdl'} onclick={() => toggleProviderDetails('subdl')} class="min-h-10 rounded-lg bg-secondary px-3 text-xs font-semibold">{$subDlApiKey ? 'Manage' : 'Set up'}</button>
  <SettingsSwitch label="Enable SubDL" value={hasProvider('subdl')} onToggle={() => toggleProvider('subdl')} />
{/snippet}
{#snippet jimakuBadge()}<SubtitleProviderBadge provider="jimaku" />{/snippet}
{#snippet jimakuMeta()}
  <span class="inline-flex items-center gap-1.5">
    <span class="size-1.5 rounded-full {!hasProvider('jimaku') ? 'bg-white/25' : $jimakuApiKey.trim() ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
    {!hasProvider('jimaku') ? 'Off' : $jimakuApiKey.trim() ? 'Ready · API key saved' : 'API key required'}
  </span>
{/snippet}
{#snippet jimakuControl()}
  <button type="button" data-focusable aria-expanded={expandedProvider === 'jimaku'} onclick={() => toggleProviderDetails('jimaku')} class="min-h-10 rounded-lg bg-secondary px-3 text-xs font-semibold">{$jimakuApiKey ? 'Manage' : 'Set up'}</button>
  <SettingsSwitch label="Enable Jimaku" value={hasProvider('jimaku')} onToggle={() => toggleProvider('jimaku')} />
{/snippet}

{#snippet typefacePreview()}
  <div class="flex min-h-40 items-center justify-center overflow-hidden rounded-xl border border-border bg-black/55 px-5 py-6 text-center">
    <div class="min-w-0">
      <p class="truncate text-xs font-bold uppercase tracking-widest text-white/45">Preview · {previewTypefaceLabel}</p>
      <div
        class="mt-5 text-2xl font-bold leading-snug"
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

<SettingsSection section="subtitles">
  <SettingsSubcategory id="appearance">
    <SettingsRow settingKey="use-custom-subtitle-style" title="Custom subtitle style" description={styleSummary} onActivate={() => ($subtitleStyleEnabled = !$subtitleStyleEnabled)} pressed={$subtitleStyleEnabled}>
      {#snippet control()}<SettingsSwitch interactive={false} label="Use custom subtitle style" value={$subtitleStyleEnabled} onToggle={() => ($subtitleStyleEnabled = !$subtitleStyleEnabled)} />{/snippet}
    </SettingsRow>
    {#if $subtitleStyleEnabled}
      <SettingsChoiceRow settingKey="typeface" title="Typeface" description="Dialogue font for your custom style." value={quickTypeface} onChange={(font) => { if (font !== 'custom') applyDialogueTypeface(font) }} options={typefaceOptions} />
      <div class="px-3 py-2.5">{@render typefacePreview()}</div>
    {/if}
    {#if !$isAndroid}
      <SettingsRow settingKey="dual-subtitles" title="Dual subtitles" description="Show a second subtitle-track picker for language learning." onActivate={() => ($secondarySubtitles = !$secondarySubtitles)} pressed={$secondarySubtitles}>
        {#snippet control()}<SettingsSwitch interactive={false} label="Dual subtitles" value={$secondarySubtitles} onToggle={() => ($secondarySubtitles = !$secondarySubtitles)} />{/snippet}
      </SettingsRow>
    {/if}
  </SettingsSubcategory>

  <SettingsSubcategory id="styles">
    {#if $savedSubtitleStyles.length}
      {#each $savedSubtitleStyles as preset (preset.id)}
        <div class="px-3 py-2.5">
          <div class="flex min-h-9 flex-wrap items-center gap-2">
            <span class="min-w-0 flex-1 basis-full sm:basis-40">
              <span class="block truncate text-sm font-bold">{preset.name}</span>
              <span class="block truncate text-xs text-muted-foreground">{preset.style.font}{preset.style.bold ? ' Bold' : ''}{preset.source?.title ? ` · ${preset.source.title}` : ''}</span>
            </span>
            {#if renamingId !== preset.id}
              <button type="button" data-touch-target onclick={() => applyPreset(preset)} data-focusable class="rounded-md bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground">Apply</button>
              <button type="button" data-touch-target onclick={() => startRename(preset)} data-focusable class="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">Rename</button>
              <button type="button" data-touch-target onclick={() => deleteSubtitlePreset(preset.id)} data-focusable aria-label={`Delete ${preset.name}`} class="rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10">Delete</button>
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
  </SettingsSubcategory>

  <SettingsSubcategory id="providers">
    <SettingsRow settingKey="opensubtitles" title="OpenSubtitles" leading={openSubtitlesBadge} meta={openSubtitlesMeta} control={openSubtitlesControl} expanded={expandedProvider === 'opensubtitles'}>
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

    <SettingsRow settingKey="subdl" title="SubDL" leading={subDlBadge} meta={subDlMeta} control={subDlControl} expanded={expandedProvider === 'subdl'}>
      <CredentialField bind:value={$subDlApiKey} label="SubDL API key" startOpen description="Enables SubDL results. The key stays on this device.">
        {#snippet help()}<a href="https://subdl.com/panel/api" target="_blank" rel="noopener noreferrer" data-focusable class="inline-flex min-h-9 items-center gap-2 font-semibold underline underline-offset-4">Get API key <ExternalLink size={12} /></a>{/snippet}
      </CredentialField>
    </SettingsRow>

    <SettingsRow settingKey="jimaku" title="Jimaku" leading={jimakuBadge} meta={jimakuMeta} control={jimakuControl} expanded={expandedProvider === 'jimaku'}>
      <CredentialField bind:value={$jimakuApiKey} label="Jimaku API key" startOpen description="Enables Jimaku results. The key stays on this device.">
        {#snippet help()}<a href="https://jimaku.cc/account" target="_blank" rel="noopener noreferrer" data-focusable class="inline-flex min-h-9 items-center gap-2 font-semibold underline underline-offset-4">Get API key <ExternalLink size={12} /></a>{/snippet}
      </CredentialField>
    </SettingsRow>
  </SettingsSubcategory>

  {#if !$isAndroid || $subtitleStyleEnabled}
    <SettingsSubcategory id="advanced" summary={$isAndroid ? 'Style scope and fine tuning' : 'Fine tuning, SDH cleanup, text filter and sync'}>
      {#if $subtitleStyleEnabled}
        <SettingsChoiceRow settingKey="subtitle-dialogue-style-overrides" title="Apply style to" description={$subtitleOverrideScope === 'dialogue' ? 'Preserves signs and positioned text where mpv can identify them.' : 'Forces one style over signs, songs, and other typesetting.'} ariaLabel="Subtitle style scope" value={$subtitleOverrideScope} onChange={(value) => ($subtitleOverrideScope = value as typeof $subtitleOverrideScope)} options={[
          { value: 'dialogue', label: 'Dialogue only' },
          { value: 'all', label: 'All elements' },
        ]} />
        <SettingsRow settingKey="bold-dialogue" title="Bold dialogue" onActivate={() => ($subtitleBold = !$subtitleBold)} pressed={$subtitleBold}>
          {#snippet control()}<SettingsSwitch interactive={false} label="Bold dialogue" value={$subtitleBold} onToggle={() => ($subtitleBold = !$subtitleBold)} />{/snippet}
        </SettingsRow>
        <SettingsRow settingKey="font-family" title="Font family" description={$isAndroid ? 'Nunito is bundled; missing device fonts fall back automatically.' : 'Any installed font, plus bundled Nunito.'} controlLayout="stack">
          {#snippet control()}
            <input type="text" list="subtitle-font-suggestions" bind:value={$subtitleFont} data-focusable aria-label="Font family" class="h-10 w-full rounded-md bg-input px-3 text-sm sm:w-48" />
            <datalist id="subtitle-font-suggestions">
              {#each FONT_SUGGESTIONS as font (font)}<option value={font}></option>{/each}
            </datalist>
          {/snippet}
        </SettingsRow>
        <SettingsRow settingKey="subtitle-colours" title="Colours" description="Text and outline.">
          {#snippet control()}
            <input type="color" bind:value={$subtitleTextColor} data-focusable aria-label="Text colour" class="h-9 w-12 rounded-md bg-input p-1" />
            <input type="color" bind:value={$subtitleBorderColor} data-focusable aria-label="Outline colour" class="h-9 w-12 rounded-md bg-input p-1" />
          {/snippet}
        </SettingsRow>
        <SettingsRow settingKey="subtitle-size" title="Size" controlLayout="stack">
          {#snippet control()}
            <input type="range" min="20" max="80" step="1" bind:value={$subtitleFontSize} data-focusable aria-label="Subtitle size" class="h-7 w-full accent-primary sm:w-48" />
            <output class="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{$subtitleFontSize}px</output>
          {/snippet}
        </SettingsRow>
        <SettingsRow settingKey="subtitle-outline" title="Outline" controlLayout="stack">
          {#snippet control()}
            <input type="range" min="0" max="8" step="0.5" bind:value={$subtitleBorderSize} data-focusable aria-label="Subtitle outline" class="h-7 w-full accent-primary sm:w-48" />
            <output class="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{$subtitleBorderSize}px</output>
          {/snippet}
        </SettingsRow>
        <SettingsRow settingKey="subtitle-shadow" title="Shadow" controlLayout="stack">
          {#snippet control()}
            <input type="range" min="0" max="8" step="0.5" bind:value={$subtitleShadow} data-focusable aria-label="Subtitle shadow" class="h-7 w-full accent-primary sm:w-48" />
            <output class="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{$subtitleShadow}px</output>
          {/snippet}
        </SettingsRow>
        <SettingsRow settingKey="subtitle-position" title="Position" controlLayout="stack">
          {#snippet control()}
            <input type="range" min="10" max="100" step="1" bind:value={$subtitlePosition} data-focusable aria-label="Subtitle position" class="h-7 w-full accent-primary sm:w-48" />
            <output class="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{$subtitlePosition}%</output>
          {/snippet}
        </SettingsRow>
      {/if}

      <!-- Speech-analysis sync shells out to a local ffmpeg, which Android has no path to — the toggle
           was a control that could never do anything there. -->
      {#if !$isAndroid}
        <SettingsRow settingKey="automatic-sync" title="Automatic sync" description="Align external text subtitles using local speech analysis." onActivate={() => ($subtitleAutoSync = !$subtitleAutoSync)} pressed={$subtitleAutoSync}>
          {#snippet control()}<SettingsSwitch interactive={false} label="Automatically sync external subtitles" value={$subtitleAutoSync} onToggle={() => ($subtitleAutoSync = !$subtitleAutoSync)} />{/snippet}
        </SettingsRow>
        <SettingsRow settingKey="remove-sdh-annotations" title="Remove SDH annotations" description="Hide speaker labels and sound descriptions." onActivate={() => ($subtitleStripSdh = !$subtitleStripSdh)} pressed={$subtitleStripSdh}>
          {#snippet control()}<SettingsSwitch interactive={false} label="Remove SDH annotations" value={$subtitleStripSdh} onToggle={() => ($subtitleStripSdh = !$subtitleStripSdh)} />{/snippet}
        </SettingsRow>
        {#if $subtitleStripSdh}
          <SettingsRow settingKey="stronger-cleanup" title="Stronger cleanup" description="Catches more annotations but can remove intentional text." onActivate={() => ($subtitleStripSdhHarder = !$subtitleStripSdhHarder)} pressed={$subtitleStripSdhHarder}>
            {#snippet control()}<SettingsSwitch interactive={false} label="Stronger SDH removal" value={$subtitleStripSdhHarder} onToggle={() => ($subtitleStripSdhHarder = !$subtitleStripSdhHarder)} />{/snippet}
          </SettingsRow>
        {/if}
        <SetupElsewhere title="Text filter" status={$subtitleRegexFilter.trim() ? 'Set' : 'Off'} where="Needs a keyboard: connect one to edit here" settingKey="text-filter">
          <SettingsRow settingKey="text-filter" title="Text filter" description="Hide lines matching an mpv regular expression.">
            {#snippet control()}
              <input type="text" bind:value={$subtitleRegexFilter} data-focusable aria-label="Subtitle text filter" placeholder="Optional regex" class="h-9 w-36 rounded-md bg-input px-3 text-sm sm:w-48" />
            {/snippet}
          </SettingsRow>
        </SetupElsewhere>
      {/if}
    </SettingsSubcategory>
  {/if}
</SettingsSection>
