<script lang="ts">
  import { onDestroy } from 'svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import { m } from '$lib/paraglide/messages.js'
  import ConnectTile from './ConnectTile.svelte'
  import { tileBusy, type ConnectService, type ConnectStates } from '$lib/onboarding/connect-state'
  import { connectStremio, connectStremioWithAuthKey, stremioAccountEmail, stremioAuthKey } from '$lib/stremio/account'
  import { createStremioLink, pollStremioLink } from '$lib/stremio/link'
  import { nuvioClient, nuvioSession } from '$lib/nuvio/auth'
  import { connectAniList } from '$lib/trackers/anilist-auth'
  import { connectMal } from '$lib/trackers/mal-auth'
  import { anilistToken, anilistUserName, malToken, malUserName } from '$lib/trackers/config'

  let { connections = $bindable(), busy = $bindable() }: { connections: ConnectStates; busy: boolean } = $props()

  let open = $state<ConnectService | null>(null)
  let stremioMode = $state<'code' | 'password'>('code')
  let email = $state('')
  let password = $state('')
  let nuvioMode = $state<'device' | 'password'>('device')
  let nuvioEmail = $state('')
  let nuvioPassword = $state('')
  // One controller per tile: two tiles can each be mid-approval, and starting a flow in one must
  // never silently kill the other's poll while its code is still on screen.
  const controllers: Partial<Record<ConnectService, AbortController>> = {}

  // The footer disables Back and Next while any tile is mid-flight, so a half-finished device
  // approval cannot be navigated away from and left polling.
  $effect(() => {
    busy = (Object.keys(connections) as ConnectService[]).some((service) => tileBusy(connections[service]))
  })

  // Reflect accounts that were already connected before setup ran, so a re-run does not offer to
  // connect something that is already live.
  $effect(() => {
    if ($stremioAuthKey && connections.stremio.status !== 'connected') connections = { ...connections, stremio: { status: 'connected', identity: $stremioAccountEmail } }
    if ($nuvioSession && connections.nuvio.status !== 'connected') connections = { ...connections, nuvio: { status: 'connected', identity: $nuvioSession.email } }
    if ($anilistToken && connections.anilist.status !== 'connected') connections = { ...connections, anilist: { status: 'connected', identity: $anilistUserName } }
    if ($malToken && connections.mal.status !== 'connected') connections = { ...connections, mal: { status: 'connected', identity: $malUserName } }
  })

  onDestroy(() => { for (const controller of Object.values(controllers)) controller?.abort() })

  function begin(service: ConnectService) {
    controllers[service]?.abort()
    return controllers[service] = new AbortController()
  }

  /** A pending code counts as busy, which disables the footer. Without this the user is pinned to
   *  this screen until the poll gives up — minutes later. Abandoning the code must always be possible. */
  function cancel(service: ConnectService) {
    controllers[service]?.abort()
    controllers[service] = undefined
    set(service, { status: 'idle' })
  }

  function set(service: ConnectService, state: ConnectStates[ConnectService]) {
    connections = { ...connections, [service]: state }
  }

  function expand(service: ConnectService) {
    open = open === service ? null : service
  }

  const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback

  async function signInStremio(event: SubmitEvent) {
    event.preventDefault()
    if (tileBusy(connections.stremio)) return
    const submitted = password
    password = ''
    set('stremio', { status: 'busy' })
    try {
      await connectStremio(email, submitted)
      set('stremio', { status: 'connected', identity: email.trim() })
      open = null
    } catch (cause) {
      set('stremio', { status: 'error', message: message(cause, m.onboarding_stremio_sync_error()) })
    }
  }

  /** Stremio's own link codes: the user approves on link.stremio.com and izumi is handed a session
   *  key, so no password is ever typed here. */
  async function connectStremioLink() {
    if (tileBusy(connections.stremio)) return
    const abort = begin('stremio')
    set('stremio', { status: 'busy' })
    try {
      const link = await createStremioLink(abort.signal)
      const showCode = (completing: boolean) => set('stremio', { status: 'code', code: link.code, url: link.url, completing })
      showCode(false)
      const authKey = await pollStremioLink(link.code, (status) => showCode(status === 'approved'), abort.signal)
      set('stremio', { status: 'connected', identity: await connectStremioWithAuthKey(authKey) })
      open = null
    } catch (cause) {
      if (abort.signal.aborted) return
      set('stremio', { status: 'error', message: message(cause, m.onboarding_connect_failed()) })
    }
  }

  async function connectNuvioDevice() {
    if (tileBusy(connections.nuvio)) return
    const abort = begin('nuvio')
    set('nuvio', { status: 'busy' })
    try {
      await nuvioClient.connectDevice((code) => set('nuvio', { status: 'code', code: code.code, url: code.url, completing: code.completing }), abort.signal)
      set('nuvio', { status: 'connected', identity: $nuvioSession?.email ?? '' })
      open = null
    } catch (cause) {
      if (abort.signal.aborted) return
      set('nuvio', { status: 'error', message: message(cause, m.onboarding_connect_failed()) })
    }
  }

  async function signInNuvio(event: SubmitEvent) {
    event.preventDefault()
    if (tileBusy(connections.nuvio)) return
    const submitted = nuvioPassword
    nuvioPassword = ''
    const abort = begin('nuvio')
    set('nuvio', { status: 'busy' })
    try {
      await nuvioClient.signIn(nuvioEmail, submitted, abort.signal)
      set('nuvio', { status: 'connected', identity: nuvioEmail.trim() })
      open = null
    } catch (cause) {
      if (abort.signal.aborted) return
      set('nuvio', { status: 'error', message: message(cause, m.onboarding_connect_failed()) })
    }
  }

  async function connectTracker(service: 'anilist' | 'mal') {
    if (tileBusy(connections[service])) return
    set(service, { status: 'busy' })
    try {
      if (service === 'anilist') await connectAniList()
      else await connectMal()
      set(service, { status: 'connected', identity: service === 'anilist' ? $anilistUserName : $malUserName })
      open = null
    } catch (cause) {
      set(service, { status: 'error', message: message(cause, m.onboarding_connect_failed()) })
    }
  }

  async function visit(url: string) {
    try { await openUrl(url) } catch { window.open(url, '_blank', 'noopener,noreferrer') }
  }
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_connect_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_connect_body()}</p>

<!-- Official marks, bundled so a tile never depends on an external image request — the same
     approach the AniList, MyAnimeList and Trakt marks in static/brand/ already take.
     stremio.png from www.stremio.com; nuvio.png from nuvio.tv, downscaled for the tile.
     Each tile falls back to a lettered square if its image ever fails to load. -->
<h2 class="mt-7 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.onboarding_connect_sources_group()}</h2>
<div class="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2">
  <ConnectTile name="Stremio" logo="/brand/stremio.png" initial="S" description={m.onboarding_connect_stremio_body()} state={connections.stremio} expanded={open === 'stremio'} onexpand={() => expand('stremio')}>
    {#snippet panel()}
      {#if connections.stremio.status === 'code'}
        <p class="text-sm font-semibold">{m.onboarding_stremio_code_title()}</p>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{m.onboarding_stremio_code_body()}</p>
        <p aria-label={m.onboarding_stremio_code_label({ code: connections.stremio.code })} class="my-4 rounded-xl border border-border bg-background py-4 text-center font-mono text-2xl font-bold tracking-[0.15em]">{connections.stremio.code}</p>
        <button type="button" data-focusable onclick={() => visit(connections.stremio.status === 'code' ? connections.stremio.url : '')} class="setup-inline-button w-full bg-foreground text-background">{m.onboarding_stremio_open()}<ArrowUpRight size={15} /></button>
        <p role="status" class="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={15} class="tile-spinner" />{connections.stremio.completing ? m.onboarding_stremio_completing() : m.onboarding_stremio_waiting()}</p>
        <button type="button" data-focusable onclick={() => cancel('stremio')} class="mt-3 min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_stremio_cancel()}</button>
      {:else if stremioMode === 'code'}
        <button type="button" data-focusable onclick={connectStremioLink} class="setup-inline-button w-full bg-foreground text-background">{m.onboarding_stremio_connect()}</button>
        <p class="mt-3 text-center text-xs leading-relaxed text-muted-foreground">{m.onboarding_stremio_link_hint()}</p>
        <button type="button" data-focusable onclick={() => stremioMode = 'password'} class="mt-2 min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_stremio_password_instead()}</button>
      {:else}
        <form onsubmit={signInStremio} class="grid gap-3">
          <label class="grid gap-2 text-sm font-semibold" for="connect-stremio-email">{m.onboarding_stremio_email()}
            <input id="connect-stremio-email" data-focusable bind:value={email} type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" required class="setup-field" /></label>
          <label class="grid gap-2 text-sm font-semibold" for="connect-stremio-password">{m.onboarding_stremio_password()}
            <input id="connect-stremio-password" data-focusable bind:value={password} type="password" autocomplete="current-password" required class="setup-field" /></label>
          <p class="text-xs leading-relaxed text-muted-foreground">{m.onboarding_stremio_credentials_hint()}</p>
          <button type="submit" data-focusable class="setup-inline-button bg-foreground text-background" disabled={!email.trim() || !password}>{m.onboarding_stremio_sign_in()}</button>
          <button type="button" data-focusable onclick={() => stremioMode = 'code'} class="min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_stremio_code_instead()}</button>
        </form>
      {/if}
    {/snippet}
  </ConnectTile>

  <ConnectTile name="Nuvio" logo="/brand/nuvio.png" initial="N" description={m.onboarding_connect_nuvio_body()} state={connections.nuvio} expanded={open === 'nuvio'} onexpand={() => expand('nuvio')}>
    {#snippet panel()}
      {#if connections.nuvio.status === 'code'}
        <p class="text-sm font-semibold">{m.onboarding_nuvio_code_title()}</p>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{m.onboarding_nuvio_code_body()}</p>
        <p aria-label={m.onboarding_nuvio_code_label({ code: connections.nuvio.code })} class="my-4 rounded-xl border border-border bg-background py-4 text-center font-mono text-2xl font-bold tracking-[0.15em]">{connections.nuvio.code}</p>
        <button type="button" data-focusable onclick={() => visit(connections.nuvio.status === 'code' ? connections.nuvio.url : '')} class="setup-inline-button w-full bg-foreground text-background">{m.onboarding_nuvio_open()}<ArrowUpRight size={15} /></button>
        <p role="status" class="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={15} class="tile-spinner" />{connections.nuvio.completing ? m.onboarding_nuvio_completing() : m.onboarding_nuvio_waiting()}</p>
        <button type="button" data-focusable onclick={() => cancel('nuvio')} class="mt-3 min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_nuvio_cancel()}</button>
      {:else if nuvioMode === 'device'}
        <button type="button" data-focusable onclick={connectNuvioDevice} class="setup-inline-button w-full bg-foreground text-background">{m.onboarding_nuvio_connect()}</button>
        <p class="mt-3 text-center text-xs leading-relaxed text-muted-foreground">{m.onboarding_nuvio_device_hint()}</p>
        <button type="button" data-focusable onclick={() => nuvioMode = 'password'} class="mt-2 min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_nuvio_password_instead()}</button>
      {:else}
        <form onsubmit={signInNuvio} class="grid gap-3">
          <label class="grid gap-2 text-sm font-semibold" for="connect-nuvio-email">{m.onboarding_stremio_email()}
            <input id="connect-nuvio-email" data-focusable bind:value={nuvioEmail} type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" required class="setup-field" /></label>
          <label class="grid gap-2 text-sm font-semibold" for="connect-nuvio-password">{m.onboarding_stremio_password()}
            <input id="connect-nuvio-password" data-focusable bind:value={nuvioPassword} type="password" autocomplete="current-password" required class="setup-field" /></label>
          <button type="submit" data-focusable class="setup-inline-button bg-foreground text-background" disabled={!nuvioEmail.trim() || !nuvioPassword}>{m.onboarding_stremio_sign_in()}</button>
          <button type="button" data-focusable onclick={() => nuvioMode = 'device'} class="min-h-10 w-full rounded-lg text-sm font-semibold hover:bg-secondary">{m.onboarding_nuvio_code_instead()}</button>
        </form>
      {/if}
    {/snippet}
  </ConnectTile>
</div>

<h2 class="mt-7 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.onboarding_connect_list_group()}</h2>
<div class="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
  <ConnectTile name="AniList" logo="/brand/anilist.svg" initial="A" description={m.onboarding_connect_tracker_body()} state={connections.anilist} expanded={open === 'anilist'} onexpand={() => connectTracker('anilist')} />
  <ConnectTile name="MyAnimeList" logo="/brand/myanimelist.svg" initial="M" description={m.onboarding_connect_tracker_body()} state={connections.mal} expanded={open === 'mal'} onexpand={() => connectTracker('mal')} />
</div>

<p class="mt-6 text-xs leading-relaxed text-muted-foreground">{m.onboarding_connect_later_hint()}</p>
