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
  } from '$lib/settings/ui'
  import Toggle from '$lib/components/settings/Toggle.svelte'

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
    <h3 class="mb-2 font-bold">Providers</h3>
    <div class="max-w-2xl space-y-3">
      <Toggle label="OpenSubtitles" desc="Search is free; downloading needs your OpenSubtitles account." value={hasProvider('opensubtitles')} onToggle={() => toggleProvider('opensubtitles')} />
      <Toggle label="SubDL" desc="Bring your own SubDL API key." value={hasProvider('subdl')} onToggle={() => toggleProvider('subdl')} />
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
  </section>
</div>
