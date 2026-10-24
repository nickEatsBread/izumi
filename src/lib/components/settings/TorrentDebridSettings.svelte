<script lang="ts">
  // Sources › Torrent and debrid. Its own component so the section page shows these rows without
  // mounting the source list, which fetches every source manifest.
  import { debridKey, debridProvider, torrentPlaybackMode } from '$lib/settings/ui'
  import { accountInfo, providerList, providerMeta, type DebridAccountInfo } from '$lib/stremio/debrid'
  import { providerIcon } from '$lib/stremio/debrid/icons'
  import { formatBytes } from '$lib/util/format'
  import RefreshButton from '$lib/components/RefreshButton.svelte'
  import CredentialField from './CredentialField.svelte'
  import SettingsChoiceRow from './SettingsChoiceRow.svelte'
  import SettingsRow from './SettingsRow.svelte'

  const current = $derived(providerMeta($debridProvider))
  const credentialLabel = $derived(`${current?.name ?? 'Debrid'} ${current?.credential === 'userpass' ? 'login' : 'API key'}`)
  const providerOptions = providerList.map((provider) => ({
    value: provider.id,
    label: `${provider.name}${provider.experimental ? ' (experimental)' : ''}`,
    icon: providerIcon(provider.id),
  }))
  let keyOpen = $state(false)
  let account = $state<DebridAccountInfo | null>(null)
  let accountError = $state('')
  async function refreshAccount() {
    if (!$debridKey) { account = null; accountError = ''; return false }
    accountError = ''
    try {
      account = await accountInfo($debridProvider, $debridKey)
      return true
    } catch (error) {
      account = null
      accountError = error instanceof Error ? error.message : String(error)
      return false
    }
  }
  const accountDate = (value?: number) => value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value)
    : ''
  $effect(() => { void $debridProvider; void $debridKey; account = null; accountError = '' })
</script>

<SettingsChoiceRow
  settingKey="torrent-playback"
  title="Torrent playback"
  description={$torrentPlaybackMode === 'direct' ? 'Streams from peers; your IP is visible to them' : 'Your debrid service, or direct P2P without a key'}
  learnMore={$torrentPlaybackMode === 'direct'
    ? 'Streams the selected episode from peers and seeds with a protected upload limit. Playback data is temporary.'
    : 'Uses your configured debrid service. If no credential is configured, Izumi falls back to direct P2P playback.'}
  value={$torrentPlaybackMode}
  options={[
    { value: 'debrid', label: 'Prefer debrid' },
    { value: 'direct', label: 'Direct P2P' },
  ]}
  onChange={(value) => ($torrentPlaybackMode = value === 'direct' ? 'direct' : 'debrid')}
/>
<SettingsChoiceRow
  settingKey="debrid-service"
  title="Debrid service"
  value={$debridProvider}
  options={providerOptions}
  onChange={(value) => ($debridProvider = value)}
/>
<SettingsRow
  settingKey="debrid-key"
  title={credentialLabel}
  description={`From ${current?.keyHint ?? 'your debrid account'}`}
  value={$debridKey ? 'Saved · hidden' : 'Not set'}
  onActivate={() => (keyOpen = !keyOpen)}
  expanded={keyOpen}
>
  <CredentialField bind:value={$debridKey}
    label={credentialLabel}
    sendFromPhone
    placeholder={current?.credential === 'userpass' ? 'username:password' : 'Paste your token'}
    description="Turns torrent results into cached streams. Only shared if you explicitly transfer a setup including credentials."
  />
</SettingsRow>
{#if $debridKey}
  <SettingsRow
    title="Account and usage"
    description={`Live data from ${current?.name ?? 'your provider'}, fetched on request`}
    expanded={!!account || !!accountError}
  >
    {#snippet control()}
      <RefreshButton
        onRefresh={refreshAccount}
        label={account ? 'Refresh' : 'Check account'}
        busyLabel="Checking…"
        successLabel="Account updated"
        errorLabel="Check failed"
        class="min-w-[8.5rem] rounded-md bg-secondary px-3 py-1.5 text-xs font-bold hover:bg-accent"
      />
    {/snippet}
    {#if account}
      <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {#if account.username}<div><dt class="text-xs text-muted-foreground">Account</dt><dd class="truncate font-bold">{account.username}</dd></div>{/if}
        {#if account.plan}<div><dt class="text-xs text-muted-foreground">Plan</dt><dd class="font-bold capitalize">{account.plan}</dd></div>{/if}
        {#if account.premiumUntil}<div><dt class="text-xs text-muted-foreground">Premium until</dt><dd class="font-bold">{accountDate(account.premiumUntil)}</dd></div>{/if}
        {#if account.points != null}<div><dt class="text-xs text-muted-foreground">Points</dt><dd class="font-bold">{account.points}</dd></div>{/if}
        {#if account.downloadedBytes != null}<div><dt class="text-xs text-muted-foreground">Downloaded</dt><dd class="font-bold tabular-nums">{formatBytes(account.downloadedBytes)}</dd></div>{/if}
      </dl>
      {#if account.quotaUsed != null}
        <div class="mt-3">
          <div class="mb-1 flex justify-between text-xs"><span>Fair-use allowance</span><span>{Math.round(account.quotaUsed * 100)}% used</span></div>
          <div class="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Fair-use allowance used" aria-valuenow={Math.round(account.quotaUsed * 100)} aria-valuemin="0" aria-valuemax="100">
            <div class="h-full rounded-full bg-theme" style={`width:${Math.round(account.quotaUsed * 100)}%`}></div>
          </div>
        </div>
      {/if}
    {:else if accountError}
      <p role="alert" class="text-xs text-amber-400">{accountError}</p>
    {/if}
  </SettingsRow>
{/if}
