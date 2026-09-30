<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener'
  import KeyRound from '@lucide/svelte/icons/key-round'
  import ShieldCheck from '@lucide/svelte/icons/shield-check'
  import SettingsGroup from './SettingsGroup.svelte'
  import SettingsRow from './SettingsRow.svelte'
  import {
    traktClientId,
    traktClientSecret,
    traktAppClientId,
    traktToken,
    traktUserName,
    traktUserSlug,
    TRAKT_SITE_REDIRECT_URI,
  } from '$lib/trakt/config'
  import { cancelTraktBrowserAuth, completeTraktBrowserAuth, startTraktBrowserAuth, traktBrowserAuth } from '$lib/trakt/browser-auth'

  let formOpen = $state(false)
  let clientIdInput = $state($traktClientId || traktAppClientId)
  let clientSecretInput = $state($traktClientSecret)
  let busy = $state(false)
  let error = $state('')
  let returnLink = $state('')
  const waiting = $derived($traktBrowserAuth.phase === 'waiting' || $traktBrowserAuth.phase === 'exchanging')
  const authError = $derived(error || ($traktBrowserAuth.phase === 'error' ? $traktBrowserAuth.message : ''))

  function saveCredentials() {
    $traktClientId = clientIdInput.trim()
    $traktClientSecret = clientSecretInput.trim()
  }

  async function connect() {
    if (busy || waiting) return
    saveCredentials()
    error = ''
    returnLink = ''
    busy = true
    try {
      await startTraktBrowserAuth()
    } catch (cause) {
      if ((cause as { name?: string })?.name !== 'AbortError') {
        error = cause instanceof Error ? cause.message : String(cause)
      }
    } finally {
      busy = false
    }
  }

  function cancel() {
    cancelTraktBrowserAuth()
    busy = false
    returnLink = ''
    error = ''
  }

  async function finishFromLink() {
    error = ''
    try { await completeTraktBrowserAuth(returnLink.trim()); returnLink = ''; formOpen = false }
    catch (reason) { error = reason instanceof Error ? reason.message : 'Trakt connection failed.' }
  }

  async function disconnect() {
    if (busy) return
    busy = true
    error = ''
    try {
      const { disconnectTrakt } = await import('$lib/trakt/auth')
      await disconnectTrakt()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  function openProfile() {
    if ($traktUserSlug) void openUrl(`https://trakt.tv/users/${encodeURIComponent($traktUserSlug)}`)
  }
</script>

{#snippet leading()}
  <img src="/brand/trakt.svg" alt="" class="size-10 shrink-0 rounded-xl" aria-hidden="true" />
{/snippet}
{#snippet meta()}
  <span class="inline-flex min-w-0 items-center gap-1.5">
    <span class="size-1.5 shrink-0 rounded-full {$traktToken ? 'bg-emerald-400' : busy || waiting ? 'bg-amber-400' : 'bg-white/25'}"></span>
    <span class="truncate">
      {$traktToken ? `Connected${$traktUserName ? ` as ${$traktUserName}` : ''}` : busy || waiting ? 'Waiting for browser approval' : 'Not connected · browser sign-in'}
    </span>
  </span>
{/snippet}
{#snippet control()}
  <button
    type="button"
    data-focusable
    aria-expanded={formOpen}
    onclick={() => (formOpen = !formOpen)}
    disabled={busy}
    class="min-h-8 rounded-md bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent disabled:opacity-40"
  >{formOpen ? 'Close' : $traktToken ? 'Manage' : 'Set up'}</button>
{/snippet}

<SettingsGroup
  icon={KeyRound}
  title="Trakt account"
  desc="Native history, Watchlist, rating sync, and a dedicated recommendation hub for this Izumi profile."
>
  <SettingsRow
    settingKey="trakt-account"
    title="Trakt"
    leading={leading}
    meta={meta}
    control={control}
    expanded={formOpen || Boolean(authError) || waiting}
  >
    {#if $traktToken}
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-[11px] leading-5 text-muted-foreground">Watches, Watchlist changes, and 1–10 ratings are mirrored automatically. Pending writes retry when Trakt is reachable again.</p>
        <div class="flex shrink-0 justify-end gap-2">
          {#if $traktUserSlug}<button type="button" data-focusable onclick={openProfile} class="min-h-9 rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent">Open profile</button>{/if}
          <a href="/app/trakt" data-focusable class="inline-flex min-h-9 items-center rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent">Open Trakt hub</a>
          <button type="button" data-focusable onclick={disconnect} disabled={busy} class="min-h-9 rounded-md px-3 text-xs font-bold text-destructive hover:bg-destructive/10 disabled:opacity-40">Disconnect</button>
        </div>
      </div>
    {:else}
      {#if !waiting}
      <p class="text-sm leading-6 text-muted-foreground">Register an application named <strong class="text-foreground">Izumi</strong> in Trakt with this redirect URI:</p>
      <code class="mt-2 block break-all text-sm text-foreground">{TRAKT_SITE_REDIRECT_URI}</code>
      <p class="mb-4 mt-2 text-xs leading-5 text-muted-foreground">Leave JavaScript origins blank, then paste your app credentials below. You’ll approve the connection in your browser.</p>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="grid gap-1 text-[11px] font-bold text-muted-foreground">
          Client ID
          <input disabled={busy || waiting} bind:value={clientIdInput} autocomplete="off" data-focusable placeholder="From Trakt app settings" class="h-10 min-w-0 rounded-md bg-input px-3 text-base text-foreground sm:text-sm" />
        </label>
        <label class="grid gap-1 text-[11px] font-bold text-muted-foreground">
          Client secret
          <input disabled={busy || waiting} bind:value={clientSecretInput} autocomplete="off" type="password" data-focusable placeholder="Stored only in this profile" class="h-10 min-w-0 rounded-md bg-input px-3 text-base text-foreground sm:text-sm" />
        </label>
      </div>
      {/if}

      {#if waiting}
        <div class="mt-4 border-l-2 border-primary pl-4" aria-live="polite">
          <p class="text-sm font-bold">{$traktBrowserAuth.phase === 'exchanging' ? 'Finishing your connection…' : 'Approve in your browser, then choose Open Izumi'}</p>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">Trakt returns to izumi.watch/link/trakt. Keep this Izumi profile selected until the connection finishes.</p>
          {#if $traktBrowserAuth.phase === 'waiting'}
            <details class="mt-3 text-sm text-muted-foreground">
              <summary class="cursor-pointer py-1" data-focusable tabindex="0">App didn’t reopen?</summary>
              <label class="mt-2 grid gap-1 text-xs">Paste the return link copied from izumi.watch
                <input type="password" bind:value={returnLink} autocomplete="off" spellcheck="false" data-focusable placeholder="izumi://auth/trakt#…" class="h-10 min-w-0 rounded-md bg-input px-3 text-base text-foreground sm:text-sm" />
              </label>
              <button type="button" data-focusable onclick={finishFromLink} disabled={!returnLink.trim()} class="mt-2 min-h-9 rounded-md bg-secondary px-3 text-xs font-bold disabled:opacity-40">Finish connection</button>
            </details>
          {/if}
        </div>
      {/if}

      <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span class="inline-flex max-w-md items-start gap-1.5 text-[11px] leading-4 text-muted-foreground"><ShieldCheck size={13} class="mt-0.5 shrink-0" aria-hidden="true" />The app exchanges the temporary code directly with Trakt. Your app secret stays on this device, inside the active profile; Izumi never includes it in profile sync.</span>
        <div class="flex shrink-0 justify-end gap-2">
          <button type="button" data-focusable onclick={() => openUrl('https://app.trakt.tv/settings/apps')} class="min-h-9 rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent">Trakt app settings</button>
          {#if busy || waiting}
            <button type="button" data-focusable onclick={cancel} class="min-h-9 rounded-md px-3 text-xs font-bold text-destructive hover:bg-destructive/10">Cancel</button>
          {:else}
            <button type="button" data-focusable onclick={connect} disabled={!clientIdInput.trim() || !clientSecretInput.trim()} class="min-h-9 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-40">Connect</button>
          {/if}
        </div>
      </div>
    {/if}
    {#if authError}<p role="alert" class="mt-2 text-xs text-destructive">{authError}</p>{/if}
  </SettingsRow>
</SettingsGroup>
