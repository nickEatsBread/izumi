<script lang="ts">
  import { episodeLayout, hideSpoilers, uiScale, showAdult, wheelScrollAcross, scheduleLayout, type EpisodeLayout, type ScheduleLayout } from '$lib/settings/ui'
  import Toggle from '$lib/components/settings/Toggle.svelte'

  const layouts: { value: EpisodeLayout; label: string; hint: string }[] = [
    { value: 'cards', label: 'Cards', hint: 'Thumbnails, titles, ratings and a watch-progress bar.' },
    { value: 'compact', label: 'Compact', hint: 'Simple text rows — denser, lighter on data.' },
  ]

  const scheduleLayouts: { value: ScheduleLayout; label: string; hint: string }[] = [
    { value: 'agenda', label: 'Agenda', hint: 'One long list — each day is a full-width section. Big and easy to read.' },
    { value: 'days', label: 'Day at a time', hint: 'Tabs across the top; one day shown large. Matches the Deck view.' },
  ]
</script>

<div class="p-8">
  <h2 class="mb-1 text-xl font-black">Interface</h2>
  <p class="mb-4 text-sm text-muted-foreground">Layout, scale, and content visibility.</p>

  <div class="max-w-2xl">
    <p class="mb-1 text-sm font-bold">Episode list layout</p>
    <div class="mb-4 grid gap-2 sm:grid-cols-2">
      {#each layouts as opt (opt.value)}
        <button
          data-focusable
          onclick={() => ($episodeLayout = opt.value)}
          aria-pressed={$episodeLayout === opt.value}
          class="rounded-md border p-3 text-left transition-colors
            {$episodeLayout === opt.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}"
        >
          <div class="flex items-center justify-between">
            <span class="font-bold">{opt.label}</span>
            {#if $episodeLayout === opt.value}<span class="text-xs font-bold text-primary">Selected</span>{/if}
          </div>
          <p class="mt-1 text-xs text-muted-foreground">{opt.hint}</p>
        </button>
      {/each}
    </div>

    <p class="mb-1 text-sm font-bold">Schedule layout <span class="font-normal text-muted-foreground">(desktop)</span></p>
    <div class="mb-4 grid gap-2 sm:grid-cols-2">
      {#each scheduleLayouts as opt (opt.value)}
        <button
          data-focusable
          onclick={() => ($scheduleLayout = opt.value)}
          aria-pressed={$scheduleLayout === opt.value}
          class="rounded-md border p-3 text-left transition-colors
            {$scheduleLayout === opt.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'}"
        >
          <div class="flex items-center justify-between">
            <span class="font-bold">{opt.label}</span>
            {#if $scheduleLayout === opt.value}<span class="text-xs font-bold text-primary">Selected</span>{/if}
          </div>
          <p class="mt-1 text-xs text-muted-foreground">{opt.hint}</p>
        </button>
      {/each}
    </div>

    <div class="space-y-3">
      <label class="flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <div class="font-bold">UI scale</div>
          <p class="mt-1 text-xs text-muted-foreground">Zoom the whole interface.</p>
        </div>
        <span class="flex items-center gap-3">
          <input type="range" min="0.5" max="2" step="0.1" data-focusable bind:value={$uiScale} class="ui-range h-2 w-40 cursor-pointer" />
          <span class="w-10 text-right text-sm tabular-nums text-muted-foreground">{$uiScale.toFixed(1)}×</span>
        </span>
      </label>

      <Toggle label="Hide spoilers" desc="Blur thumbnails, titles and ratings of aired-but-unwatched episodes." value={$hideSpoilers} onToggle={() => ($hideSpoilers = !$hideSpoilers)} />
      <Toggle label="Show 18+ content" desc="Include adult titles in browse and search results." value={$showAdult} onToggle={() => ($showAdult = !$showAdult)} />
      <Toggle label="Wheel-scroll carousels" desc="Let the mouse wheel scroll home rows sideways. Off = use the row's ‹ › arrows." value={$wheelScrollAcross} onToggle={() => ($wheelScrollAcross = !$wheelScrollAcross)} />
    </div>
  </div>
</div>

<style>
  .ui-range {
    -webkit-appearance: none;
    appearance: none;
    border-radius: 9999px;
    background: rgb(255 255 255 / 0.18);
  }
  .ui-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    height: 1rem;
    width: 1rem;
    border-radius: 9999px;
    background: hsl(346.6 79.12% 51.18%);
    border: 2px solid #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
  }
  .ui-range::-moz-range-thumb {
    height: 1rem;
    width: 1rem;
    border: 2px solid #fff;
    border-radius: 9999px;
    background: hsl(346.6 79.12% 51.18%);
  }
</style>
