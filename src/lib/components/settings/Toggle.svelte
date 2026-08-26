<script lang="ts">
  // Shared settings toggle row (label + description + switch). The switch uses the
  // pink `theme` accent (the app's `--primary` is near-white, so a white knob on a
  // primary track would be invisible). `data-switch` marks the track as a fixed-geometry
  // pill so the "Larger interaction targets" a11y mode grows its TARGET, not its box
  // (a 44px floor on both axes would square the pill into a circle) — see app.css.
  import * as h from '$lib/haptics'
  import type { Snippet } from 'svelte'
  import { ripple } from '$lib/actions/ripple'
  import { settingKey as keyForSetting } from '$lib/settings/search'
  let { label, desc, value, onToggle, leading }: {
    label: string
    desc: string
    value: boolean
    onToggle: () => void
    leading?: Snippet
  } = $props()
  const settingKey = $derived(keyForSetting(label))
</script>

<button
  data-focusable
  data-setting-key={settingKey}
  use:ripple
  onclick={() => { h.tap(); onToggle() }}
  aria-pressed={value}
  class="ripple-host flex min-h-12 w-full items-center justify-between rounded-md border border-border px-3 py-2.5 text-left transition-colors active:bg-secondary sm:hover:bg-secondary"
>
  <div class="flex min-w-0 items-center gap-2.5 pr-3">
    {#if leading}<span class="shrink-0">{@render leading()}</span>{/if}
    <div class="min-w-0">
      <div class="font-bold">{label}</div>
      <p class="mt-0.5 text-xs leading-4 text-muted-foreground">{desc}</p>
    </div>
  </div>
  <span data-switch class="relative ml-4 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors {value ? 'bg-theme' : 'bg-white/30 ring-1 ring-inset ring-white/20'}">
    <span class="inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform {value ? 'translate-x-5' : 'translate-x-0.5'}"></span>
  </span>
</button>
