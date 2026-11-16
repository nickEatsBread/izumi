<script lang="ts">
  // Settings > Sources and store > Store: the packs set up on this device, what each added, removing
  // one, and setting one up from a link.
  import { goto } from '$app/navigation'
  import Package from '@lucide/svelte/icons/package'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import { installedPacks, type PackRecord } from '$lib/packs/installed'
  import { removePack } from '$lib/packs/session'
  import { defaultPackDeps } from '$lib/packs/deps'
  import { canonicalStoreUrl } from '$lib/store/url'

  let link = $state('')
  let linkError = $state('')
  let confirming = $state<string | null>(null)
  let removing = $state<string | null>(null)
  let notice = $state('')

  function domain(url: string) {
    try { return new URL(url).hostname } catch { return url }
  }

  function summary(pack: PackRecord): string {
    const parts = [
      ...pack.items.filter((item) => item.added).map((item) => item.name),
      ...pack.modules.map((id) => `${id} module`),
      ...(pack.startup ? ['startup animation'] : []),
    ]
    return parts.length ? `Added ${parts.join(', ')}` : 'Added nothing new'
  }

  function openLink() {
    const url = canonicalStoreUrl(link.trim())
    if (!url) { linkError = 'Enter the https link to a pack.json.'; return }
    linkError = ''
    void goto(`/app/pack?url=${encodeURIComponent(url)}`)
  }

  async function remove(pack: PackRecord) {
    removing = pack.id
    const problems = await removePack(pack, defaultPackDeps)
    removing = null
    confirming = null
    notice = problems.length ? `${pack.name} removed, but: ${problems.join('; ')}` : `${pack.name} removed.`
  }
</script>

{#each $installedPacks as pack (pack.id)}
  <SettingsRow title={pack.name} description="{summary(pack)} · {domain(pack.url)} · version {pack.version}">
    {#snippet control()}
      {#if confirming === pack.id}
        <span class="flex items-center gap-2">
          <button type="button" data-focusable disabled={removing === pack.id} class="rounded-md bg-destructive px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60" onclick={() => void remove(pack)}>
            {removing === pack.id ? 'Removing…' : 'Remove it and what it added'}
          </button>
          <button type="button" data-focusable class="rounded-md px-3 py-1.5 text-xs font-bold hover:bg-accent" onclick={() => (confirming = null)}>Cancel</button>
        </span>
      {:else}
        <button type="button" data-focusable class="rounded-md bg-secondary px-3 py-1.5 text-xs font-bold hover:bg-accent" onclick={() => (confirming = pack.id)}>Remove</button>
      {/if}
    {/snippet}
  </SettingsRow>
{/each}
{#if notice}<p role="status" class="px-4 py-2 text-sm text-muted-foreground">{notice}</p>{/if}
<SettingsRow settingKey="packs-add" title="Set up from a pack" description="A pack link installs a set of sources, a theme and more after you review it">
  {#snippet control()}
    <form class="flex w-full items-center gap-2 sm:w-auto" onsubmit={(event) => { event.preventDefault(); openLink() }}>
      <Package class="hidden shrink-0 text-muted-foreground sm:block" size={16} />
      <input
        data-focusable
        type="url"
        inputmode="url"
        placeholder="https://…/pack.json"
        bind:value={link}
        aria-label="Pack link"
        class="h-9 w-full rounded-md bg-input px-3 text-sm sm:w-64"
      />
      <button type="submit" data-focusable class="h-9 shrink-0 rounded-md bg-secondary px-3 text-xs font-bold hover:bg-accent">Open</button>
    </form>
  {/snippet}
</SettingsRow>
{#if linkError}<p role="alert" class="px-4 pb-2 text-sm text-destructive">{linkError}</p>{/if}
