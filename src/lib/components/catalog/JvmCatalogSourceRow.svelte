<script lang="ts">
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import AddonLogo from '$lib/components/player/AddonLogo.svelte'
  import type { JvmCatalogSource } from '$lib/extensions/manager'

  let { source, enabled, onToggle }: {
    source: JvmCatalogSource
    enabled: boolean
    onToggle: () => void
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
  <SettingsSwitch
    interactive={false}
    value={enabled}
    label={`${enabled ? 'Hide' : 'Show'} ${source.name} in the JVM catalog`}
    {onToggle}
  />
{/snippet}

<SettingsRow
  title={source.name}
  {leading}
  {meta}
  {control}
  onActivate={onToggle}
  pressed={enabled}
/>
