<script lang="ts">
  let {
    headline = 'Getting episode ready',
    detail = '',
    placement = 'preparing',
    metric = '',
    metricLabel = '',
    live = 'polite',
    oncancel,
  }: {
    headline?: string
    detail?: string
    placement?: 'preparing' | 'player'
    metric?: string
    metricLabel?: string
    live?: 'off' | 'polite'
    oncancel?: () => void
  } = $props()
</script>

<!-- One restrained status rail inside the lower edge of the video. It deliberately is not a
     floating pill: a second rounded popup over the preparing watch page read like a second modal. -->
<div
  class="android-connection inset-x-0 z-[55] border-y border-white/10 bg-[#111214]/95 shadow-[0_-10px_28px_rgba(0,0,0,.28)] {placement === 'player' ? 'absolute' : 'fixed'}"
  data-placement={placement}
  role="status"
  aria-live={live}
>
  <div class="flex min-h-14 items-center gap-3 px-4 py-2.5">
    <span class="relative grid size-7 shrink-0 place-items-center" aria-hidden="true">
      <span class="absolute size-6 animate-ping rounded-full bg-theme/20"></span>
      <span class="relative size-2.5 rounded-full bg-theme shadow-[0_0_14px_var(--theme)]"></span>
    </span>
    <span class="min-w-0 flex-1">
      <strong class="block truncate text-sm font-extrabold text-white">{headline}</strong>
      {#if detail}<span class="mt-0.5 block truncate text-[0.7rem] text-white/50">{detail}</span>{/if}
    </span>
    {#if metric}
      <span class="shrink-0 text-right font-mono font-black tabular-nums text-white">
        <span class="block text-sm leading-none">{metric}</span>
        {#if metricLabel}<span class="mt-1 block text-[0.6rem] font-bold uppercase tracking-wide text-white/45">{metricLabel}</span>{/if}
      </span>
    {/if}
    {#if oncancel}
      <button data-focusable onclick={oncancel}
            class="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.08] text-base text-white/70 active:bg-white/15"
            aria-label="Cancel preparing playback">✕</button>
    {/if}
  </div>
  <div class="h-1 overflow-hidden bg-white/[0.08]"><div class="bar-loader h-full w-full"></div></div>
</div>

<style>
  .android-connection {
    top: calc(env(safe-area-inset-top) + 56.25vw - 3.75rem);
  }
  .android-connection[data-placement='player'] {
    top: auto;
    bottom: 0;
  }
  @media (orientation: landscape) {
    .android-connection {
      top: auto;
      bottom: max(0px, env(safe-area-inset-bottom));
    }
    .android-connection[data-placement='player'] {
      bottom: max(0px, var(--player-safe-bottom, 0px));
    }
  }
</style>
