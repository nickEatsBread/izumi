<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { activeProfile } from '$lib/profiles/store'
  import { stremioAuthKey } from '$lib/stremio/account'
  import { cloudAccountRequest, type CloudAccountState } from '$lib/sync/cloudflare'
  import { Check, ExternalLink, LoaderCircle, RefreshCw, Tv } from '@lucide/svelte'

  let accounts = $state<CloudAccountState[]>([])
  let profiles = $state<Array<{ id: number; name: string; locked: boolean }>>([])
  let selectedProfile = $state('')
  let busy = $state('loading'), error = $state(''), notice = $state('')
  let link = $state<{ code: string; url: string; interval: number } | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let alive = true
  const scope = $activeProfile.id
  const api = <T,>(input?: Record<string, unknown>) => cloudAccountRequest<T>(scope, input)
  const nuvio = $derived(accounts.find(account => account.service === 'nuvio'))
  const stremio = $derived(accounts.find(account => account.service === 'stremio'))

  async function refresh() {
    const result = await api<{ accounts: CloudAccountState[] }>()
    if (!alive) return
    accounts = result.accounts
    if (accounts.some(value => value.service === 'nuvio' && value.connected)) {
      const response = await api<{ profiles: typeof profiles }>({ service: 'nuvio', action: 'profiles' })
      if (!alive) return
      profiles = response.profiles
      selectedProfile = String(nuvio?.profile || profiles.find(value => !value.locked)?.id || '')
    }
  }
  async function run(name: string, action: () => Promise<void>) {
    busy = name; error = ''; notice = ''
    try { await action() } catch (cause) { if (alive) error = cause instanceof Error ? cause.message : 'TV account connection failed.' }
    finally { if (alive) busy = '' }
  }
  async function poll() {
    if (!alive || !link) return
    try {
      const result = await api<{ pending?: boolean; connected?: boolean }>({ service: 'nuvio', action: 'poll' })
      if (!alive || !link) return
      if (result.connected) { link = null; await run('refresh', refresh); notice = 'Nuvio connected. Choose the profile your TV should use.' }
      else timer = setTimeout(poll, (link.interval || 3) * 1000)
    } catch (cause) { if (alive) { error = cause instanceof Error ? cause.message : 'Sign-in failed.'; link = null } }
  }
  function cancelLink() { clearTimeout(timer); link = null }
  async function configure(account: CloudAccountState, changes: Partial<CloudAccountState>) {
    await api({ service: account.service, action: 'configure', profile: account.profile,
      sources: account.sources, playback: account.playback, ...changes })
    await refresh(); notice = 'TV sync preferences saved. Reopen the TV catalogue to refresh.'
  }
  onMount(() => { void run('loading', refresh) })
  onDestroy(() => { alive = false; cancelLink() })
</script>

<section class="mt-6 border-t border-border pt-5" aria-labelledby="tv-accounts-title">
  <div class="flex items-start justify-between gap-4">
    <div><h3 id="tv-accounts-title" class="flex items-center gap-2 text-base font-black"><Tv size={19} /> TV accounts</h3>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">Browse your library and Nuvio collections while Izumi is closed. These connections belong to <strong class="text-foreground">{$activeProfile.name}</strong>.</p></div>
    <button data-focusable class="grid min-h-11 min-w-11 place-items-center rounded-lg bg-secondary disabled:opacity-50" aria-label="Refresh TV accounts" disabled={!!busy} onclick={() => run('refresh', refresh)}><RefreshCw size={17} class={busy === 'refresh' ? 'animate-spin' : ''} /></button>
  </div>
  <p class="mt-2 text-xs leading-5 text-muted-foreground">Connecting stores an account session in your private Worker so it can contact the service. Library and collection reads are automatic; sending playback progress is optional.</p>
  {#if busy === 'loading'}<p role="status" class="mt-4 flex items-center gap-2 text-sm"><LoaderCircle class="animate-spin" size={16} /> Loading connections…</p>{/if}
  <div class="mt-4 divide-y divide-border">
    {#each ['nuvio', 'stremio'] as service}
      {@const account = service === 'nuvio' ? nuvio : stremio}
      {@const label = service === 'nuvio' ? 'Nuvio' : 'Stremio'}
      <div class="py-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><h4 class="font-bold">{label}</h4><p class="mt-1 text-xs text-muted-foreground">{account?.connected ? account.email || 'Connected for TV' : 'Not connected for TV'}</p></div>
          {#if account?.connected}
            <button data-focusable disabled={!!busy} class="min-h-10 rounded-lg bg-secondary px-3 text-sm font-semibold disabled:opacity-50" onclick={() => run(service, async () => { await api({ service, action: 'disconnect' }); await refresh(); notice = `${label} disconnected from this TV profile.` })}>Disconnect</button>
          {:else if service === 'nuvio'}
            <button data-focusable disabled={!!busy || !!link} class="min-h-11 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50" onclick={() => run(service, async () => { link = await api({ service, action: 'link' }); timer = setTimeout(poll, link!.interval * 1000) })}>Connect Nuvio for TV</button>
          {:else}
            <button data-focusable disabled={!!busy || !$stremioAuthKey} class="min-h-11 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50" onclick={() => run(service, async () => { await api({ service, action: 'connect', authKey: $stremioAuthKey }); await refresh(); notice = 'Stremio connected. Choose what to sync below.' })}>Use connected Stremio account</button>
          {/if}
        </div>
        {#if service === 'stremio' && !account?.connected && !$stremioAuthKey}<a href="/app/settings/accounts" data-focusable class="mt-2 inline-flex min-h-10 items-center text-sm underline underline-offset-4">Sign in to Stremio in Accounts <ExternalLink size={14} class="ml-2" /></a>{/if}
        {#if service === 'nuvio' && link}
          <div class="mt-4 rounded-lg bg-secondary p-4"><p class="text-sm">Approve this TV connection on nuvio.tv</p><p class="my-3 font-mono text-3xl font-bold tracking-widest">{link.code.slice(0,3)}-{link.code.slice(3)}</p>
            <div class="flex flex-wrap gap-2"><button data-focusable class="min-h-11 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground" onclick={() => run('open', async () => { await openUrl(link!.url) })}>Open Nuvio <ExternalLink size={14} class="ml-1 inline" /></button><button data-focusable class="min-h-11 rounded-lg px-4 text-sm font-semibold" onclick={cancelLink}>Cancel</button></div><p role="status" class="mt-2 text-xs text-muted-foreground">Waiting for approval. Keep this page open.</p></div>
        {/if}
        {#if account?.connected}
          {#if service === 'nuvio'}
            <label class="mt-4 block text-sm font-semibold" for="tv-nuvio-profile">Nuvio profile</label>
            <div class="mt-2 flex flex-wrap gap-2"><select id="tv-nuvio-profile" data-focusable bind:value={selectedProfile} disabled={!!busy} class="min-h-11 min-w-40 rounded-lg border border-border bg-background px-3 text-sm"><option value="" disabled>Choose a profile</option>{#each profiles as profile}<option value={String(profile.id)} disabled={profile.locked}>{profile.name}{profile.locked ? ' · PIN protected' : ''}</option>{/each}</select>
              <button data-focusable disabled={!!busy || !selectedProfile} class="min-h-11 rounded-lg bg-secondary px-4 text-sm font-bold disabled:opacity-50" onclick={() => run(service, () => configure(account, { profile: Number(selectedProfile) }))}>{account.profile ? 'Save profile' : 'Use this profile'}</button></div>
            <p class="mt-2 text-xs text-muted-foreground">PIN-protected Nuvio profiles cannot be unlocked through its public API.</p>
          {/if}
          {#each [{ key: 'sources' as const, label: 'Use account add-ons on TV', detail: 'Refresh enabled Stremio-compatible add-ons from this account.' }, { key: 'playback' as const, label: `Send TV playback to ${label}`, detail: service === 'nuvio' ? 'Update resume positions and record completed titles as you watch.' : 'Update resume positions as you watch.' }] as setting}
            <label class="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-sm"><input type="checkbox" data-focusable checked={account[setting.key]} disabled={!!busy || service === 'nuvio' && !account.profile} class="mt-1 size-4 accent-primary" onchange={(event) => run(service, () => configure(account, { [setting.key]: event.currentTarget.checked }))} /><span><strong>{setting.label}</strong><span class="mt-1 block text-xs leading-5 text-muted-foreground">{setting.detail}</span></span></label>
          {/each}
          {#if account.updatedAt}<p class="mt-3 text-xs text-muted-foreground">Last read {new Date(account.updatedAt).toLocaleString()}</p>{/if}
        {/if}
      </div>
    {/each}
  </div>
  {#if error}<p role="alert" class="mt-3 text-sm text-destructive">{error}</p>{/if}
  {#if notice}<p role="status" class="mt-3 flex items-start gap-2 text-sm"><Check size={17} class="shrink-0" />{notice}</p>{/if}
  <p class="mt-4 text-xs leading-5 text-muted-foreground">On TV, open the izumi logo to choose an account library or collection. Custom Nuvio JavaScript providers use linked-device playback.</p>
</section>
