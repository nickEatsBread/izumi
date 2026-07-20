<script lang="ts">
  // Shared settings toggle row (label + description + switch). The switch uses the
  // pink `theme` accent (the app's `--primary` is near-white, so a white knob on a
  // primary track would be invisible).
  import * as h from '$lib/haptics'
  import { settingKey as keyForSetting } from '$lib/settings/search'
  let { label, desc, value, onToggle }: {
    label: string
    desc: string
    value: boolean
    onToggle: () => void
  } = $props()
  const settingKey = $derived(keyForSetting(label))
</script>

<button
  data-focusable
  data-setting-key={settingKey}
  onclick={() => { h.tap(); onToggle() }}
  aria-pressed={value}
  class="flex w-full items-center justify-between rounded-md border border-border p-3 text-left transition-colors hover:bg-secondary"
>
  <div class="min-w-0 pr-4">
    <div class="font-bold">{label}</div>
    <p class="mt-1 text-xs text-muted-foreground">{desc}</p>
  </div>
  <span class="relative ml-4 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors {value ? 'bg-theme' : 'bg-white/30 ring-1 ring-inset ring-white/20'}">
    <span class="inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform {value ? 'translate-x-5' : 'translate-x-0.5'}"></span>
  </span>
</button>
