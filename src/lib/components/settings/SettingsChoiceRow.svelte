<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import SettingsRow from './SettingsRow.svelte'
  import SelectMenu from './SelectMenu.svelte'

  // A value row: every card grid, chip group, native <select> and bordered SelectMenu in Settings
  // becomes one of these, printing its current value at the right.
  let {
    title,
    description,
    learnMore,
    settingKey,
    value,
    options,
    onChange,
    searchable = false,
    ariaLabel,
  }: {
    title: string
    description?: string
    learnMore?: string
    settingKey?: string
    value: string
    options: ComponentProps<typeof SelectMenu>['options']
    onChange: (value: string) => void
    searchable?: boolean
    /** Default: the row title. */
    ariaLabel?: string
  } = $props()
</script>

{#snippet control()}
  <SelectMenu variant="inline" {value} {options} {onChange} {searchable} ariaLabel={ariaLabel ?? title} />
{/snippet}

<SettingsRow {title} {description} {learnMore} {settingKey} {control} />
