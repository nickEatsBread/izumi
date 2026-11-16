<script lang="ts">
  import X from '@lucide/svelte/icons/x'
  import SettingsRow from './SettingsRow.svelte'
  import SelectMenu from './SelectMenu.svelte'
  import { PLAYBACK_LANGUAGES, playbackLanguageName } from '$lib/shared/languages'
  import { SUBTITLES_OFF } from '$lib/settings/catalog-languages'

  // An ordered language list: the chips are the order (most wanted first, each removable) and the
  // picker adds the next language. Empty means "not set here", shown as `unsetLabel`.
  let {
    title,
    description,
    settingKey,
    order,
    onChange,
    unsetLabel,
    allowOff = false,
  }: {
    title: string
    description?: string
    settingKey?: string
    order: string[]
    onChange: (order: string[]) => void
    /** The picker's text while nothing is set, e.g. "Automatic" or "Same as default". */
    unsetLabel: string
    /** Subtitles: offer Off. */
    allowOff?: boolean
  } = $props()

  const labelOf = (tag: string) => (tag === SUBTITLES_OFF ? 'Off' : playbackLanguageName(tag))
  const options = $derived([
    { value: '', label: order.length ? 'Add language' : unsetLabel },
    ...(order.length ? [{ value: 'reset', label: unsetLabel }] : []),
    ...(allowOff && order[0] !== SUBTITLES_OFF ? [{ value: SUBTITLES_OFF, label: 'Off' }] : []),
    ...PLAYBACK_LANGUAGES.filter((language) => !order.includes(language.value)),
  ])

  function pick(value: string) {
    if (!value) return
    if (value === 'reset') onChange([])
    else if (value === SUBTITLES_OFF) onChange([SUBTITLES_OFF])
    else onChange([...order.filter((tag) => tag !== SUBTITLES_OFF), value])
  }
</script>

{#snippet control()}
  <div class="flex flex-wrap items-center justify-end gap-1.5">
    {#each order as tag, index (tag)}
      <button
        type="button"
        data-focusable
        onclick={() => onChange(order.filter((item) => item !== tag))}
        aria-label={`Remove ${labelOf(tag)} from ${title}`}
        class="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs font-bold transition-colors hover:bg-accent active:bg-accent"
      >
        {#if order.length > 1}<span class="tabular-nums text-muted-foreground">{index + 1}</span>{/if}
        {labelOf(tag)}
        <X size={12} aria-hidden="true" />
      </button>
    {/each}
    <SelectMenu variant="inline" value="" {options} onChange={pick} searchable ariaLabel={order.length ? `Add to ${title}` : title} />
  </div>
{/snippet}

<SettingsRow {title} {description} {settingKey} {control} controlLayout="stack" />
