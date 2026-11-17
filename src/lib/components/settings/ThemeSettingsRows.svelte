<script lang="ts">
  import SettingsChoiceRow from './SettingsChoiceRow.svelte'
  import SettingsRow from './SettingsRow.svelte'
  import SettingsSwitch from './SettingsSwitch.svelte'
  import type { StudioTheme } from '$lib/settings/theme-studio'
  import { settingValue } from '$lib/themes/theme-settings'
  import { resetThemeSettings, setThemeSetting, themeSettingValues } from '$lib/themes/theme-setting-values'

  // A theme's own settings (Theme API 9), as Settings rows. The same rows show on the theme's page and in
  // Appearance; a change applies at once wherever the theme is showing.
  let { design, named = false }: { design: StudioTheme; /** Prefix each title with the theme's name (Appearance). */ named?: boolean } = $props()
  const title = (label: string) => (named ? `${design.name} · ${label}` : label)

  const stored = $derived($themeSettingValues[design.id] ?? {})
  const changed = $derived(Object.keys(stored).length > 0)
</script>

{#each design.settings ?? [] as setting (setting.key)}
  {@const value = settingValue(setting, stored[setting.key])}
  {#if setting.type === 'toggle'}
    <SettingsRow
      title={title(setting.label)}
      description={setting.description}
      onActivate={() => setThemeSetting(design.id, setting.key, !value)}
      pressed={value === true}
    >
      {#snippet control()}
        <SettingsSwitch value={value === true} onToggle={() => setThemeSetting(design.id, setting.key, !value)} label={setting.label} interactive={false} />
      {/snippet}
    </SettingsRow>
  {:else if setting.type === 'choice'}
    <SettingsChoiceRow
      title={title(setting.label)}
      description={setting.description}
      value={String(value)}
      options={(setting.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
      onChange={(next) => setThemeSetting(design.id, setting.key, next)}
    />
  {:else}
    <SettingsRow title={title(setting.label)} description={setting.description}>
      {#snippet control()}
        <input
          type="color"
          data-focusable
          aria-label={setting.label}
          value={String(value)}
          oninput={(event) => setThemeSetting(design.id, setting.key, event.currentTarget.value.toLowerCase())}
          class="h-10 w-14 cursor-pointer rounded-lg border border-border bg-transparent p-1"
        />
      {/snippet}
    </SettingsRow>
  {/if}
{/each}
{#if changed}
  <SettingsRow title="Reset theme settings" description={`Back to ${design.name}'s own choices`}>
    {#snippet control()}
      <button type="button" data-focusable onclick={() => resetThemeSettings(design.id)} class="min-h-10 rounded-lg bg-secondary px-3 text-sm font-bold hover:bg-accent">Reset</button>
    {/snippet}
  </SettingsRow>
{/if}
