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
    subtitleFont,
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
  import Toggle from '$lib/components/settings/Toggle.svelte'
  import { isAndroid } from '$lib/platform'

  // Font names libass can actually resolve. Nunito travels with the app on every platform (the
  // Android player registers it through the plugin's bundled fonts directory); the rest are the
  // families that are present on essentially every Android device, so a pick here renders rather
  // than silently falling back. Desktop additionally resolves any installed system font, which is
  // why this stays a free-text field with suggestions instead of a closed dropdown.
  const FONT_SUGGESTIONS = ['Nunito', 'Roboto', 'Noto Sans', 'Noto Serif', 'Noto Sans Mono', 'sans-serif']

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
    $subtitleProviders = hasProvider(id)
      ? $subtitleProviders.filter((p) => p !== id)
      : [...$subtitleProviders, id]
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
  <p class="mb-4 max-w-2xl text-sm text-muted-foreground">Search external providers for subtitles and load them during playback.</p>

  <section class="mb-8 max-w-2xl">
    <h3 class="mb-2 font-bold">Appearance</h3>
    <div class="space-y-4 rounded-md border border-border p-4">
      <Toggle label="Use custom subtitle style" desc="Override embedded ASS styling with the choices below." value={$subtitleStyleEnabled} onToggle={() => ($subtitleStyleEnabled = !$subtitleStyleEnabled)} />
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">Font family</span>
        <input type="text" list="subtitle-font-suggestions" bind:value={$subtitleFont} data-focusable disabled={!$subtitleStyleEnabled} class="rounded-md bg-input px-3 py-2 text-sm disabled:opacity-50" />
        <datalist id="subtitle-font-suggestions">
          {#each FONT_SUGGESTIONS as font (font)}<option value={font}></option>{/each}
        </datalist>
        <span class="text-xs text-muted-foreground">
          {#if $isAndroid}
            Nunito ships with the app; the other suggestions are your device's own fonts. A name this device has no font for falls back to the system sans-serif.
          {:else}
            Any font installed on this computer, plus the bundled Nunito.
          {/if}
        </span>
      </label>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm font-bold">Text colour</span>
          <input type="color" bind:value={$subtitleTextColor} data-focusable disabled={!$subtitleStyleEnabled} class="h-10 w-full rounded-md bg-input p-1 disabled:opacity-50" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm font-bold">Border colour</span>
          <input type="color" bind:value={$subtitleBorderColor} data-focusable disabled={!$subtitleStyleEnabled} class="h-10 w-full rounded-md bg-input p-1 disabled:opacity-50" />
        </label>
      </div>
      <label class="block text-sm">
        <span class="flex justify-between font-bold"><span>Font size</span><span>{$subtitleFontSize}px</span></span>
        <input type="range" min="20" max="80" step="1" bind:value={$subtitleFontSize} data-focusable disabled={!$subtitleStyleEnabled} class="w-full accent-primary disabled:opacity-50" />
      </label>
      <label class="block text-sm">
        <span class="flex justify-between font-bold"><span>Border</span><span>{$subtitleBorderSize}px</span></span>
        <input type="range" min="0" max="8" step="0.5" bind:value={$subtitleBorderSize} data-focusable disabled={!$subtitleStyleEnabled} class="w-full accent-primary disabled:opacity-50" />
      </label>
      <label class="block text-sm">
        <span class="flex justify-between font-bold"><span>Shadow</span><span>{$subtitleShadow}px</span></span>
        <input type="range" min="0" max="8" step="0.5" bind:value={$subtitleShadow} data-focusable disabled={!$subtitleStyleEnabled} class="w-full accent-primary disabled:opacity-50" />
      </label>
      <label class="block text-sm">
        <span class="flex justify-between font-bold"><span>Vertical position</span><span>{$subtitlePosition}%</span></span>
        <input type="range" min="10" max="100" step="1" bind:value={$subtitlePosition} data-focusable disabled={!$subtitleStyleEnabled} class="w-full accent-primary disabled:opacity-50" />
      </label>
    </div>
  </section>

  <!-- Speech-analysis sync shells out to a local ffmpeg, which Android has no path to — the toggle
       was a control that could never do anything there. -->
  {#if !$isAndroid}
  <section class="mb-8 max-w-2xl">
    <h3 class="mb-2 font-bold">Synchronization</h3>
      <Toggle
      label="Automatically sync external subtitles"
      desc="Uses local ffmpeg speech analysis when a text subtitle is selected. Embedded image/ASS tracks are left unchanged."
      value={$subtitleAutoSync}
      onToggle={() => ($subtitleAutoSync = !$subtitleAutoSync)}
      />
      <Toggle label="Dual subtitles" desc="Expose a second subtitle-track picker in the player for language learning." value={$secondarySubtitles} onToggle={() => ($secondarySubtitles = !$secondarySubtitles)} />
      <Toggle label="Remove SDH annotations" desc="Hide hearing-impaired cues such as speaker labels and sound descriptions." value={$subtitleStripSdh} onToggle={() => ($subtitleStripSdh = !$subtitleStripSdh)} />
      {#if $subtitleStripSdh}
        <Toggle label="Stronger SDH removal" desc="Also remove less conventional annotations; may hide intentional dialogue text." value={$subtitleStripSdhHarder} onToggle={() => ($subtitleStripSdhHarder = !$subtitleStripSdhHarder)} />
      {/if}
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">Subtitle text filter</span>
        <input type="text" bind:value={$subtitleRegexFilter} data-focusable placeholder="Optional regular expression" class="rounded-md bg-input px-3 py-2 text-sm" />
        <span class="text-xs text-muted-foreground">Lines matching this mpv regular expression are hidden. Leave empty to disable.</span>
      </label>
  </section>
  {/if}

  <section class="mb-8 max-w-2xl">
    <h3 class="mb-2 font-bold">Providers</h3>
    <div class="max-w-2xl space-y-3">
      <Toggle label="OpenSubtitles" desc="Search is free; downloading needs your OpenSubtitles account." value={hasProvider('opensubtitles')} onToggle={() => toggleProvider('opensubtitles')} />
      <Toggle label="SubDL" desc="Bring your own SubDL API key." value={hasProvider('subdl')} onToggle={() => toggleProvider('subdl')} />
      <Toggle label="Jimaku" desc="Community Japanese subtitles. Bring your own Jimaku API key." value={hasProvider('jimaku')} onToggle={() => toggleProvider('jimaku')} />
    </div>
  </section>

  <section class="mb-8 max-w-2xl">
    <div class="mb-6 rounded-md border border-border p-4">
      <h4 class="mb-2 font-bold">OpenSubtitles account</h4>
      {#if $openSubtitlesToken && $openSubtitlesUserName}
        <div class="flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
          <span class="truncate">Connected as <span class="font-bold">{$openSubtitlesUserName}</span></span>
          <button onclick={disconnectOpenSubtitles} data-focusable class="ml-2 text-destructive">Disconnect</button>
        </div>
        {#if osAllowed > 0}
          <div class="mt-2 flex items-center justify-between rounded-md bg-secondary px-3 py-2 text-sm">
            <span>Downloads left today <span class="font-bold">{osRemaining}/{osAllowed}</span></span>
          </div>
        {/if}
      {:else}
        <div class="flex flex-col gap-2">
          <input type="text" bind:value={osUser} data-focusable placeholder="Username" class="rounded-md bg-input px-3 py-2 text-sm" />
          <input type="password" bind:value={osPass} data-focusable placeholder="Password" class="rounded-md bg-input px-3 py-2 text-sm" />
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={osStay} data-focusable class="mt-0.5" />
            <span>
              <span class="font-bold">Stay signed in</span>
              <span class="block text-xs text-muted-foreground">Stores your sign-in locally so it's reused next launch. You may need to sign in again when it expires.</span>
            </span>
          </label>
          <button onclick={connectOpenSubtitles} data-focusable disabled={osBusy} class="self-start rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50">
            {osBusy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
        {#if osError}<p class="mt-2 text-sm text-destructive">{osError}</p>{/if}
      {/if}
    </div>
    <p class="text-xs text-muted-foreground">Downloads spend your account's free quota (~20/day; VIP 1000).</p>
  </section>

  <section class="max-w-2xl">
    <label class="mb-6 flex flex-col gap-1">
      <span class="text-sm font-bold">SubDL API key</span>
      <input type="password" bind:value={$subDlApiKey} data-focusable class="rounded-md bg-input px-3 py-2 text-sm" />
      <span class="text-xs text-muted-foreground">From your SubDL account panel.</span>
    </label>
    <label class="mb-6 flex flex-col gap-1">
      <span class="text-sm font-bold">Jimaku API key</span>
      <input type="password" bind:value={$jimakuApiKey} data-focusable class="rounded-md bg-input px-3 py-2 text-sm" />
      <span class="text-xs text-muted-foreground">From your Jimaku account page. Without it Jimaku is skipped entirely.</span>
    </label>
  </section>
</div>
