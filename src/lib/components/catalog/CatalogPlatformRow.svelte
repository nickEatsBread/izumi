<script lang="ts">
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import CatalogPlatformLogo from './CatalogPlatformLogo.svelte'
  import type { CatalogSelection } from '$lib/settings/catalog'

  let {
    label,
    platform,
    description,
    enabled,
    locked = false,
    settingKey,
    onToggle,
  }: {
    label: string
    platform: CatalogSelection
    description: string
    enabled: boolean
    locked?: boolean
    settingKey?: string
    onToggle: () => void
  } = $props()
</script>

{#snippet meta()}
  <span>{description}{locked ? ' · Keep at least one platform enabled' : ''}</span>
{/snippet}

{#snippet control()}
  <SettingsSwitch interactive={false} value={enabled} label={`${enabled ? 'Disable' : 'Enable'} ${label}`} {onToggle} />
{/snippet}

{#snippet leading()}
  <CatalogPlatformLogo {platform} />
{/snippet}

<SettingsRow {settingKey} title={label} {leading} {meta} {control} onActivate={onToggle} pressed={enabled} />
