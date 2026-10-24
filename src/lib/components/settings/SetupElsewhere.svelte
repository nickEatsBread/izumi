<script lang="ts">
  import type { Snippet } from 'svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import SettingsRow from './SettingsRow.svelte'
  import { settingsControllerMode } from '$lib/settings/surface'

  let { title, status, where, settingKey, children }: {
    title: string
    /** Muted value on the row ("Set", "Not set", "Connected"). */
    status: string
    /** Where it is set up, one line. */
    where: string
    settingKey?: string
    children: Snippet
  } = $props()
  let expanded = $state(false)
</script>

{#snippet disclosure()}
  <ChevronDown size={16} class="shrink-0 text-muted-foreground transition-transform {expanded ? 'rotate-180' : ''}" aria-hidden="true" />
{/snippet}

<!-- Controller mode (spec §5.4): typing-heavy setup shows as a status row that says where to do it;
     A still opens the full controls for someone with a keyboard. Elsewhere they render as they are. -->
{#if $settingsControllerMode}
  <SettingsRow {title} description={where} value={status} {settingKey} control={disclosure} onActivate={() => (expanded = !expanded)} {expanded} {children} />
{:else}
  {@render children()}
{/if}
