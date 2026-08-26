<script lang="ts">
  import * as h from '$lib/haptics'

  let {
    value,
    onToggle,
    label,
    interactive = true,
  }: {
    value: boolean
    onToggle: () => void
    label: string
    interactive?: boolean
  } = $props()
</script>

{#snippet track()}
  <span class="inline-block size-4 transform rounded-full bg-white shadow transition-transform {value ? 'translate-x-[18px]' : 'translate-x-0.5'}"></span>
{/snippet}

{#if interactive}
  <button
    data-focusable
    data-switch
    type="button"
    aria-label={label}
    aria-pressed={value}
    onclick={() => { h.tap(); onToggle() }}
    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors {value ? 'bg-theme' : 'bg-white/25 ring-1 ring-inset ring-white/20'}"
  >
    {@render track()}
  </button>
{:else}
  <span
    data-switch
    aria-hidden="true"
    class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors {value ? 'bg-theme' : 'bg-white/25 ring-1 ring-inset ring-white/20'}"
  >
    {@render track()}
  </span>
{/if}
