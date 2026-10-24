<script lang="ts">
  import type { Snippet } from 'svelte'
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

<!-- Controller mode (spec §5.4): typing-heavy setup shows as a status row that says where to do it;
     A still opens the full controls for someone with a keyboard. Elsewhere they render as they are. -->
{#if $settingsControllerMode}
  <SettingsRow {title} description={where} value={status} {settingKey} chevron onActivate={() => (expanded = !expanded)} {expanded} {children} />
{:else}
  {@render children()}
{/if}
