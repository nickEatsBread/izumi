<script lang="ts">
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import AddonLogo from '$lib/components/player/AddonLogo.svelte'
  import type { JvmCatalogSource } from '$lib/extensions/manager'
  import Settings from '@lucide/svelte/icons/settings'

  let { source, enabled, onToggle, onSettings }: {
    source: JvmCatalogSource
    enabled: boolean
    onToggle: () => void
    onSettings?: () => void
  } = $props()

  const capabilities = $derived([
    source.supportsPopular ? 'popular' : '',
    source.supportsLatest ? 'latest updates' : '',
  ].filter(Boolean).join(' and ') || 'search')
</script>

{#snippet leading()}
  <AddonLogo logo={source.icon} name={source.name} id={source.id} size={40} />
{/snippet}

{#snippet meta()}
  <span>{source.lang?.toUpperCase() ?? 'Unknown language'} · Browse {capabilities}</span>
{/snippet}

{#snippet control()}
  {#if onSettings}
    <button type="button" data-focusable aria-label={`Configure ${source.name}`} onclick={onSettings} class="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
      <Settings size={17} />
    </button>
  {/if}
  <SettingsSwitch
    interactive
    value={enabled}
    label={`${enabled ? 'Hide' : 'Show'} ${source.name} in the Aniyomi catalog`}
    {onToggle}
  />
{/snippet}

<SettingsRow
  title={source.name}
  {leading}
  {meta}
  {control}
/>
