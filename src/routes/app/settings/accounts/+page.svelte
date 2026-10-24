<script lang="ts">
  import { anilistUser } from '$lib/anilist/account'
  import SettingsSection from '$lib/components/settings/SettingsSection.svelte'
  import SettingsSubcategory from '$lib/components/settings/SettingsSubcategory.svelte'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import TrackerProviderBadge from '$lib/components/settings/TrackerProviderBadge.svelte'
  import TraktAccountSettings from '$lib/components/settings/TraktAccountSettings.svelte'
  import LetterboxdAccountSettings from '$lib/components/settings/LetterboxdAccountSettings.svelte'
  import ProfileManager from '$lib/components/profiles/ProfileManager.svelte'
  import { nuvioSession } from '$lib/nuvio/auth'
  import {
    autoIncognitoAdult, autoWatchlistEnabled, autoWatchlistEpisodes, debridKey, jimakuApiKey, openSubtitlesToken, showAdult, subDlApiKey,
  } from '$lib/settings/ui'
  import { omdbApiKey, tmdbReadToken } from '$lib/settings/catalog'
  import { KEY_HUB, keyHubHref, type KeyHubId } from '$lib/settings/keys-hub'
  import { m } from '$lib/paraglide/messages.js'
  import {
    anilistToken,
    anilistUserName,
    kitsuToken,
    kitsuUserName,
    malToken,
    malUser,
    malUserName,
    simklToken,
    simklUserName,
  } from '$lib/trackers/config'
  import { trackerQueue } from '$lib/trackers/queue'
  import {
    connectStremio,
    disconnectStremio,
    stremioAccountEmail,
    stremioAuthKey,
  } from '$lib/stremio/account'
  import {
    resetStremioAddonSync,
    stremioAddonSyncState,
    syncStremioAddons,
  } from '$lib/stremio/account-sync'
  import type { SimklPin } from '$lib/trackers/simkl-auth'
  import Blocks from '@lucide/svelte/icons/blocks'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import Clock3 from '@lucide/svelte/icons/clock-3'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import ShieldCheck from '@lucide/svelte/icons/shield-check'
  import { page } from '$app/state'
  import { activeProfile, profiles, profilesEnabled } from '$lib/profiles/store'
  import { profileAvatarUrl } from '$lib/profiles/avatars'

  // The household manager is full screen with its own PIN gate and exit path; it opens over this
  // page from Profiles and from the profile switcher.
  const managingProfiles = $derived(page.url.searchParams.get('manage') === 'profiles')

  const keySaved = $derived<Record<KeyHubId, boolean>>({
    tmdb: !!$tmdbReadToken.trim(),
    omdb: !!$omdbApiKey.trim(),
    opensubtitles: !!$openSubtitlesToken,
    subdl: !!$subDlApiKey.trim(),
    jimaku: !!$jimakuApiKey.trim(),
    debrid: !!$debridKey.trim(),
  })
  const keyValue = (id: KeyHubId) => (!keySaved[id] ? 'Not set' : id === 'opensubtitles' ? 'Signed in' : 'Saved · hidden')

  type PublicProfile = 'anilist' | 'mal'

  let publicProfileOpen = $state<PublicProfile | null>(null)
  let kitsuFormOpen = $state(false)

  let aniInput = $state($anilistUser)
  let malInput = $state($malUser)

  let aniBusy = $state(false)
  let aniError = $state('')
  let malBusy = $state(false)
  let malError = $state('')
  let kitsuBusy = $state(false)
  let kitsuError = $state('')
  let kitsuLogin = $state('')
  let kitsuPassword = $state('')
  let simklBusy = $state(false)
  let simklError = $state('')
  let simklPin = $state<SimklPin | null>(null)
  let stremioFormOpen = $state(false)
  let stremioEmail = $state($stremioAccountEmail)
  let stremioPassword = $state('')
  let stremioBusy = $state<'connect' | 'sync' | 'disconnect' | ''>('')
  let stremioError = $state('')

  function togglePublicProfile(profile: PublicProfile) {
    publicProfileOpen = publicProfileOpen === profile ? null : profile
  }

  function updateWatchlistThreshold(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const value = Math.max(1, Math.floor(Number(input.value) || 1))
    autoWatchlistEpisodes.set(value)
    input.value = String(value)
  }

  function saveAni() {
    $anilistUser = aniInput.trim()
    publicProfileOpen = null
  }

  function clearAni() {
    $anilistUser = ''
    aniInput = ''
    publicProfileOpen = null
  }

  function saveMal() {
    $malUser = malInput.trim()
    publicProfileOpen = null
  }

  function clearMal() {
    $malUser = ''
    malInput = ''
    publicProfileOpen = null
  }

  async function connectAniListClick() {
    aniError = ''
    aniBusy = true
    try {
      const { connectAniList } = await import('$lib/trackers/anilist-auth')
      await connectAniList()
    } catch (error) {
      aniError = error instanceof Error ? error.message : String(error)
    } finally {
      aniBusy = false
    }
  }

  async function disconnectAniListClick() {
    const { disconnectAniList } = await import('$lib/trackers/anilist-auth')
    disconnectAniList()
    aniError = ''
  }

  async function connectMalClick() {
    malError = ''
    malBusy = true
    try {
      const { connectMal } = await import('$lib/trackers/mal-auth')
      await connectMal()
    } catch (error) {
      malError = error instanceof Error ? error.message : String(error)
    } finally {
      malBusy = false
    }
  }

  async function disconnectMalClick() {
    const { disconnectMal } = await import('$lib/trackers/mal-auth')
    disconnectMal()
    malError = ''
  }

  async function connectKitsuClick() {
    kitsuError = ''
    kitsuBusy = true
    const password = kitsuPassword
    kitsuPassword = ''
    try {
      const { connectKitsu } = await import('$lib/trackers/kitsu-auth')
      await connectKitsu(kitsuLogin, password)
      kitsuFormOpen = false
    } catch (error) {
      kitsuError = error instanceof Error ? error.message : String(error)
    } finally {
      kitsuBusy = false
    }
  }

  async function disconnectKitsuClick() {
    const { disconnectKitsu } = await import('$lib/trackers/kitsu-auth')
    disconnectKitsu()
    kitsuError = ''
    kitsuFormOpen = false
  }

  async function connectSimklClick() {
    simklError = ''
    simklPin = null
    simklBusy = true
    try {
      const { connectSimkl } = await import('$lib/trackers/simkl-auth')
      await connectSimkl((pin) => { simklPin = pin })
    } catch (error) {
      simklError = error instanceof Error ? error.message : String(error)
    } finally {
      simklBusy = false
      simklPin = null
    }
  }

  async function disconnectSimklClick() {
    const { disconnectSimkl } = await import('$lib/trackers/simkl-auth')
    disconnectSimkl()
    simklError = ''
  }

  async function connectStremioClick() {
    if (stremioBusy) return
    stremioError = ''
    stremioBusy = 'connect'
    const password = stremioPassword
    stremioPassword = ''
    try {
      await connectStremio(stremioEmail, password)
      resetStremioAddonSync()
      await syncStremioAddons()
      stremioFormOpen = false
    } catch (error) {
      stremioError = error instanceof Error ? error.message : String(error)
    } finally {
      stremioBusy = ''
    }
  }

  async function syncStremioClick() {
    if (stremioBusy) return
    stremioError = ''
    stremioBusy = 'sync'
    try {
      await syncStremioAddons()
    } catch (error) {
      stremioError = error instanceof Error ? error.message : String(error)
    } finally {
      stremioBusy = ''
    }
  }

  async function disconnectStremioClick() {
    if (stremioBusy) return
    stremioError = ''
    stremioBusy = 'disconnect'
    resetStremioAddonSync()
    await disconnectStremio()
    stremioEmail = ''
    stremioPassword = ''
    stremioFormOpen = false
    stremioBusy = ''
  }
</script>

{#snippet anilistBadge()}<TrackerProviderBadge provider="anilist" />{/snippet}
{#snippet malBadge()}<TrackerProviderBadge provider="mal" />{/snippet}
{#snippet kitsuBadge()}<TrackerProviderBadge provider="kitsu" />{/snippet}
{#snippet simklBadge()}<TrackerProviderBadge provider="simkl" />{/snippet}

{#snippet anilistMeta()}
  <span class="inline-flex min-w-0 items-center gap-1.5">
    <span class="size-1.5 shrink-0 rounded-full {$anilistToken ? 'bg-emerald-400' : 'bg-white/25'}"></span>
    <span class="truncate">{$anilistToken ? `Connected${$anilistUserName ? ` as ${$anilistUserName}` : ''}` : 'Not connected · browser sign-in'}</span>
  </span>
{/snippet}
{#snippet malMeta()}
  <span class="inline-flex min-w-0 items-center gap-1.5">
    <span class="size-1.5 shrink-0 rounded-full {$malToken ? 'bg-emerald-400' : 'bg-white/25'}"></span>
    <span class="truncate">{$malToken ? `Connected${$malUserName ? ` as ${$malUserName}` : ''}` : 'Not connected · browser sign-in'}</span>
  </span>
{/snippet}
{#snippet kitsuMeta()}
  <span class="inline-flex min-w-0 items-center gap-1.5">
    <span class="size-1.5 shrink-0 rounded-full {$kitsuToken ? 'bg-emerald-400' : 'bg-white/25'}"></span>
    <span class="truncate">{$kitsuToken ? `Connected${$kitsuUserName ? ` as ${$kitsuUserName}` : ''}` : 'Not connected · account sign-in'}</span>
  </span>
{/snippet}
{#snippet simklMeta()}
  <span class="inline-flex min-w-0 items-center gap-1.5">
    <span class="size-1.5 shrink-0 rounded-full {$simklToken ? 'bg-emerald-400' : simklBusy ? 'bg-amber-400' : 'bg-white/25'}"></span>
    <span class="truncate">{$simklToken ? `Connected${$simklUserName ? ` as ${$simklUserName}` : ''}` : simklBusy ? 'Waiting for browser approval' : 'Not connected · device code'}</span>
  </span>
{/snippet}

{#snippet anilistControl()}
  {#if $anilistToken}
    <button type="button" data-focusable data-touch-target onclick={disconnectAniListClick} class="min-h-8 rounded-md px-2.5 text-xs font-bold text-destructive transition-colors hover:bg-destructive/10">Disconnect</button>
  {:else}
    <button type="button" data-focusable data-touch-target onclick={connectAniListClick} disabled={aniBusy} class="min-h-8 rounded-md bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent disabled:opacity-40">{aniBusy ? 'Connecting…' : 'Connect'}</button>
  {/if}
{/snippet}
{#snippet malControl()}
  {#if $malToken}
    <button type="button" data-focusable data-touch-target onclick={disconnectMalClick} class="min-h-8 rounded-md px-2.5 text-xs font-bold text-destructive transition-colors hover:bg-destructive/10">Disconnect</button>
  {:else}
    <button type="button" data-focusable data-touch-target onclick={connectMalClick} disabled={malBusy} class="min-h-8 rounded-md bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent disabled:opacity-40">{malBusy ? 'Connecting…' : 'Connect'}</button>
  {/if}
{/snippet}
{#snippet kitsuControl()}
  {#if $kitsuToken}
    <button type="button" data-focusable data-touch-target onclick={disconnectKitsuClick} class="min-h-8 rounded-md px-2.5 text-xs font-bold text-destructive transition-colors hover:bg-destructive/10">Disconnect</button>
  {:else}
    <button type="button" data-focusable data-touch-target onclick={() => (kitsuFormOpen = !kitsuFormOpen)} class="min-h-8 rounded-md bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent">{kitsuFormOpen ? 'Cancel' : 'Sign in'}</button>
  {/if}
{/snippet}
{#snippet simklControl()}
  {#if $simklToken}
    <button type="button" data-focusable data-touch-target onclick={disconnectSimklClick} class="min-h-8 rounded-md px-2.5 text-xs font-bold text-destructive transition-colors hover:bg-destructive/10">Disconnect</button>
  {:else}
    <button type="button" data-focusable data-touch-target onclick={connectSimklClick} disabled={simklBusy} class="min-h-8 rounded-md bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent disabled:opacity-40">{simklBusy ? 'Waiting…' : 'Connect'}</button>
  {/if}
{/snippet}

{#snippet aniPublicMeta()}
  <span class="inline-flex min-w-0 items-center gap-1.5">
    <span class="size-1.5 shrink-0 rounded-full {$anilistUser ? 'bg-sky-400' : 'bg-white/25'}"></span>
    <span class="truncate">{$anilistUser ? `Using ${$anilistUser}` : 'Not set'}</span>
  </span>
{/snippet}
{#snippet malPublicMeta()}
  <span class="inline-flex min-w-0 items-center gap-1.5">
    <span class="size-1.5 shrink-0 rounded-full {$malUser ? 'bg-sky-400' : 'bg-white/25'}"></span>
    <span class="truncate">{$malUser ? `Using ${$malUser}` : 'Not set'}</span>
  </span>
{/snippet}
{#snippet aniPublicControl()}
  <ChevronDown size={17} class="transition-transform {publicProfileOpen === 'anilist' ? 'rotate-180' : ''}" aria-hidden="true" />
{/snippet}
{#snippet malPublicControl()}
  <ChevronDown size={17} class="transition-transform {publicProfileOpen === 'mal' ? 'rotate-180' : ''}" aria-hidden="true" />
{/snippet}

{#snippet autoWatchlistControl()}
  <SettingsSwitch
    interactive={false}
    label="Automatically add watched shows"
    value={$autoWatchlistEnabled}
    onToggle={() => ($autoWatchlistEnabled = !$autoWatchlistEnabled)}
  />
{/snippet}

{#snippet stremioLeading()}
  <span class="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-violet-300" aria-hidden="true"><Blocks size={16} /></span>
{/snippet}
{#snippet stremioMeta()}
  <span class="inline-flex min-w-0 items-center gap-1.5">
    <span class="size-1.5 shrink-0 rounded-full {$stremioAuthKey ? ($stremioAddonSyncState.state === 'error' ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-white/25'}"></span>
    <span class="truncate">
      {#if !$stremioAuthKey}
        Not connected · account sign-in
      {:else if $stremioAddonSyncState.state === 'syncing'}
        Syncing add-ons…
      {:else if $stremioAddonSyncState.state === 'synced'}
        {$stremioAddonSyncState.count} add-on{$stremioAddonSyncState.count === 1 ? '' : 's'} synced
      {:else}
        Connected{ $stremioAccountEmail ? ` as ${$stremioAccountEmail}` : '' }
      {/if}
    </span>
  </span>
{/snippet}
{#snippet stremioControl()}
  <button
    type="button"
    data-focusable
    data-touch-target onclick={() => (stremioFormOpen = !stremioFormOpen)}
    disabled={Boolean(stremioBusy)}
    class="min-h-8 rounded-md bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent disabled:opacity-40"
  >{$stremioAuthKey ? (stremioFormOpen ? 'Close' : 'Manage') : (stremioFormOpen ? 'Cancel' : 'Sign in')}</button>
{/snippet}
{#snippet watchlistThresholdControl()}
  <label class="flex items-center gap-2 text-xs font-bold text-muted-foreground">
    <input
      type="number"
      min="1"
      step="1"
      value={$autoWatchlistEpisodes}
      data-focusable
      disabled={!$autoWatchlistEnabled}
      aria-label="Episodes before adding to Watchlist"
      onchange={updateWatchlistThreshold}
      class="h-9 w-20 rounded-md bg-input px-2 text-center text-sm font-black text-foreground disabled:opacity-40"
    />
    episodes
  </label>
{/snippet}
{#snippet queueLeading()}
  <span class="grid size-8 place-items-center rounded-lg bg-amber-500/10 text-amber-300" aria-hidden="true"><Clock3 size={16} /></span>
{/snippet}
{#snippet queueMeta()}
  <span>{$trackerQueue.length} update{$trackerQueue.length === 1 ? '' : 's'} will retry automatically when the connection returns.</span>
{/snippet}
{#snippet profileLeading()}
  <img src={profileAvatarUrl($activeProfile.avatar, $activeProfile.color)} alt="" class="size-8 rounded-lg" />
{/snippet}
{#snippet adultSwitch()}<SettingsSwitch value={$showAdult} onToggle={() => ($showAdult = !$showAdult)} label={m.settings_show_adult()} interactive={false} />{/snippet}
{#snippet incognitoSwitch()}<SettingsSwitch value={$autoIncognitoAdult} onToggle={() => ($autoIncognitoAdult = !$autoIncognitoAdult)} label={m.settings_auto_incognito()} interactive={false} />{/snippet}

<SettingsSection section="accounts">
  {#if managingProfiles}<ProfileManager />{/if}

  <SettingsSubcategory id="trackers">
    <SettingsRow settingKey="anilist-account" title="AniList" leading={anilistBadge} meta={anilistMeta} control={anilistControl} expanded={Boolean(aniError)}>
      {#if aniError}<p role="alert" class="text-xs text-destructive">{aniError}</p>{/if}
    </SettingsRow>

    <SettingsRow settingKey="myanimelist-account" title="MyAnimeList" leading={malBadge} meta={malMeta} control={malControl} expanded={Boolean(malError)}>
      {#if malError}<p role="alert" class="text-xs text-destructive">{malError}</p>{/if}
    </SettingsRow>

    <SettingsRow settingKey="kitsu-account" title="Kitsu" leading={kitsuBadge} meta={kitsuMeta} control={kitsuControl} expanded={!$kitsuToken && (kitsuFormOpen || Boolean(kitsuError))}>
      <div class="grid gap-2 sm:grid-cols-2">
        <label for="kitsu-login" class="sr-only">Kitsu username or email</label>
        <input id="kitsu-login" bind:value={kitsuLogin} autocomplete="username" data-focusable placeholder="Username or email" class="h-10 min-w-0 rounded-md bg-input px-3 text-base sm:text-sm" />
        <label for="kitsu-password" class="sr-only">Kitsu password</label>
        <input
          id="kitsu-password"
          bind:value={kitsuPassword}
          autocomplete="current-password"
          type="password"
          data-focusable
          placeholder="Password"
          class="h-10 min-w-0 rounded-md bg-input px-3 text-base sm:text-sm"
          onkeydown={(event) => event.key === 'Enter' && !kitsuBusy && connectKitsuClick()}
        />
      </div>
      <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck size={13} aria-hidden="true" />Your password is exchanged once and never saved.</span>
        <button type="button" data-focusable onclick={connectKitsuClick} disabled={kitsuBusy || !kitsuLogin.trim() || !kitsuPassword} class="min-h-9 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-40">{kitsuBusy ? 'Signing in…' : 'Sign in'}</button>
      </div>
      {#if kitsuError}<p role="alert" class="mt-2 text-xs text-destructive">{kitsuError}</p>{/if}
    </SettingsRow>

    <SettingsRow settingKey="simkl-account" title="Simkl" leading={simklBadge} meta={simklMeta} control={simklControl} expanded={Boolean(simklPin || simklError)}>
      {#if simklPin}
        <div class="rounded-lg bg-secondary/70 px-3 py-3">
          <p class="text-xs text-muted-foreground">The approval page is open in your browser. Enter this code:</p>
          <strong class="mt-1 block font-mono text-xl tracking-[0.18em]">{simklPin.code}</strong>
        </div>
      {/if}
      {#if simklError}<p role="alert" class="mt-2 text-xs text-destructive">{simklError}</p>{/if}
    </SettingsRow>

    <TraktAccountSettings />

    <SettingsRow title={$nuvioSession ? 'Nuvio connected' : 'Connect Nuvio'} description={$nuvioSession?.email || 'Approve a device code on Nuvio, or sign in with email'} href="/app/nuvio" chevron />

    <SettingsRow
      settingKey="stremio-addon-account"
      title="Stremio add-on sync"
      learnMore="Keeps installed Stremio add-ons aligned with your Stremio account. Other Izumi sources are excluded."
      leading={stremioLeading}
      meta={stremioMeta}
      control={stremioControl}
      expanded={stremioFormOpen || Boolean(stremioError) || $stremioAddonSyncState.state === 'error'}
    >
      {#if $stremioAuthKey}
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="min-w-0 text-xs leading-5 text-muted-foreground">
            Add, remove, or reconfigure a Stremio add-on in either app and the collection is reconciled on the next sync.
          </p>
          <div class="flex shrink-0 justify-end gap-2">
            <button
              type="button"
              data-focusable
              data-touch-target onclick={syncStremioClick}
              disabled={Boolean(stremioBusy) || $stremioAddonSyncState.state === 'syncing'}
              class="inline-flex min-h-9 items-center gap-2 rounded-md bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent disabled:opacity-40"
            ><RefreshCw size={14} class={$stremioAddonSyncState.state === 'syncing' ? 'animate-spin' : ''} />{stremioBusy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
            <button
              type="button"
              data-focusable
              data-touch-target onclick={disconnectStremioClick}
              disabled={Boolean(stremioBusy)}
              class="min-h-9 rounded-md px-3 text-xs font-bold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
            >{stremioBusy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button>
          </div>
        </div>
      {:else}
        <div class="grid gap-2 sm:grid-cols-2">
          <label for="stremio-email" class="sr-only">Stremio email</label>
          <input id="stremio-email" bind:value={stremioEmail} autocomplete="username" inputmode="email" data-focusable placeholder="Email" class="h-10 min-w-0 rounded-md bg-input px-3 text-base sm:text-sm" />
          <label for="stremio-password" class="sr-only">Stremio password</label>
          <input
            id="stremio-password"
            bind:value={stremioPassword}
            autocomplete="current-password"
            type="password"
            data-focusable
            placeholder="Password"
            class="h-10 min-w-0 rounded-md bg-input px-3 text-base sm:text-sm"
            onkeydown={(event) => event.key === 'Enter' && !stremioBusy && connectStremioClick()}
          />
        </div>
        <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck size={13} aria-hidden="true" />Your password is exchanged once and never saved.</span>
          <button
            type="button"
            data-focusable
            onclick={connectStremioClick}
            disabled={Boolean(stremioBusy) || !stremioEmail.trim() || !stremioPassword}
            class="min-h-9 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-40"
          >{stremioBusy === 'connect' ? 'Signing in…' : 'Sign in and sync'}</button>
        </div>
      {/if}
      {#if stremioError || $stremioAddonSyncState.state === 'error'}
        <p role="alert" class="mt-2 text-xs text-destructive">{stremioError || ($stremioAddonSyncState.state === 'error' ? $stremioAddonSyncState.message : '')}</p>
      {/if}
    </SettingsRow>

    <LetterboxdAccountSettings />

    <SettingsRow
      settingKey="anilist-public-profile"
      title="AniList public profile"
      learnMore="Browse a public AniList or MyAnimeList library without signing in. These profiles are never updated."
      leading={anilistBadge}
      meta={aniPublicMeta}
      control={aniPublicControl}
      expanded={publicProfileOpen === 'anilist'}
      onActivate={() => togglePublicProfile('anilist')}
      pressed={publicProfileOpen === 'anilist'}
    >
      <label for="ani-public-user" class="mb-1 block text-xs font-bold">Public username</label>
      <div class="flex flex-col gap-2 sm:flex-row">
        <input id="ani-public-user" bind:value={aniInput} data-focusable autocomplete="off" placeholder="AniList username" class="h-10 min-w-0 flex-1 rounded-md bg-input px-3 text-base sm:text-sm" onkeydown={(event) => event.key === 'Enter' && saveAni()} />
        <div class="grid grid-cols-2 gap-2 sm:flex">
          <button type="button" data-focusable onclick={saveAni} disabled={!aniInput.trim() || aniInput.trim() === $anilistUser} class="min-h-10 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-40">Save</button>
          <button type="button" data-focusable onclick={clearAni} disabled={!$anilistUser} class="min-h-10 rounded-md px-3 text-xs font-bold text-destructive hover:bg-destructive/10 disabled:opacity-40">Clear</button>
        </div>
      </div>
    </SettingsRow>

    <SettingsRow
      settingKey="myanimelist-public-profile"
      title="MyAnimeList public profile"
      leading={malBadge}
      meta={malPublicMeta}
      control={malPublicControl}
      expanded={publicProfileOpen === 'mal'}
      onActivate={() => togglePublicProfile('mal')}
      pressed={publicProfileOpen === 'mal'}
    >
      <label for="mal-public-user" class="mb-1 block text-xs font-bold">Public username</label>
      <div class="flex flex-col gap-2 sm:flex-row">
        <input id="mal-public-user" bind:value={malInput} data-focusable autocomplete="off" placeholder="MyAnimeList username" class="h-10 min-w-0 flex-1 rounded-md bg-input px-3 text-base sm:text-sm" onkeydown={(event) => event.key === 'Enter' && saveMal()} />
        <div class="grid grid-cols-2 gap-2 sm:flex">
          <button type="button" data-focusable onclick={saveMal} disabled={!malInput.trim() || malInput.trim() === $malUser} class="min-h-10 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-40">Save</button>
          <button type="button" data-focusable onclick={clearMal} disabled={!$malUser} class="min-h-10 rounded-md px-3 text-xs font-bold text-destructive hover:bg-destructive/10 disabled:opacity-40">Clear</button>
        </div>
      </div>
    </SettingsRow>

    <SettingsRow
      settingKey="automatically-add-watched-shows"
      title="Automatically add watched shows"
      description="After enough episodes are watched, add the title to the device Watchlist."
      learnMore="Local list state works without an account and is mirrored to connected trackers."
      control={autoWatchlistControl}
      onActivate={() => ($autoWatchlistEnabled = !$autoWatchlistEnabled)}
      pressed={$autoWatchlistEnabled}
    />
    <SettingsRow
      settingKey="episodes-before-watchlist"
      title="Episodes before Watchlist"
      description="Choose any whole number from 1 upwards."
      control={watchlistThresholdControl}
    />
    {#if $trackerQueue.length}
      <SettingsRow title="Pending tracker updates" leading={queueLeading} meta={queueMeta} />
    {/if}
    <p data-nav-line class="px-3 py-2.5 text-xs leading-5 text-muted-foreground">Browse lists in <a href="/app/library" data-focusable class="font-bold text-foreground underline underline-offset-4">Library</a>. Add list add-ons in <a href="/app/settings/sources" data-focusable class="font-semibold text-foreground underline underline-offset-4">Sources</a> and arrange their rows in <a href="/app/settings/library/home?provider=stremio" data-focusable class="font-semibold text-foreground underline underline-offset-4">Customize Home</a>.</p>
  </SettingsSubcategory>

  <SettingsSubcategory id="keys">
    {#each KEY_HUB as entry (entry.id)}
      <SettingsRow settingKey={`key-${entry.id}`} title={entry.title} description={entry.description} value={keyValue(entry.id)} href={keyHubHref(entry)} chevron />
    {/each}
  </SettingsSubcategory>

  <SettingsSubcategory id="profiles">
    <SettingsRow
      settingKey="household-profiles"
      title="Household profiles"
      description="Own watchlist, history and accounts for each person, with optional PINs"
      value={$profilesEnabled ? `${$profiles.length} ${$profiles.length === 1 ? 'profile' : 'profiles'}` : 'Off'}
      leading={$profilesEnabled ? profileLeading : undefined}
      href="/app/settings/accounts?manage=profiles"
      chevron
    />
  </SettingsSubcategory>

  <SettingsSubcategory id="content">
    <SettingsRow settingKey="show-18-content" title={m.settings_show_adult()} description={m.settings_show_adult_hint()} control={adultSwitch} onActivate={() => ($showAdult = !$showAdult)} pressed={$showAdult} />
    <SettingsRow settingKey="incognito-for-18-titles" title={m.settings_auto_incognito()} description={m.settings_auto_incognito_hint()} learnMore={m.settings_auto_incognito_more()} control={incognitoSwitch} onActivate={() => ($autoIncognitoAdult = !$autoIncognitoAdult)} pressed={$autoIncognitoAdult} />
  </SettingsSubcategory>
</SettingsSection>
