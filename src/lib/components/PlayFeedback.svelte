<script lang="ts">
  // The stand-in shown between a Play/episode tap and the real player-flow overlay being ready.
  //
  // It exists because those overlays are lazily imported and their graph carries lottie-web (~300KB),
  // so on a cold HTTP cache the gate opens and the chunk is still on the network. Everything here is
  // therefore deliberately cheap and EAGERLY bundled: no lottie, no images, no store subscriptions,
  // no imports at all. A CSS ring and a line of text. If this file ever grows an import, check first
  // that it does not drag the very chunk it is covering for into the boot bundle.
  let { label }: { label: string } = $props()
</script>

<!-- Same z-index band as the overlays it precedes, so nothing renders on top of it and the handover
     is invisible: the real skeleton replaces this in place. -->
<div class="fixed inset-0 z-50 grid place-items-center bg-black/80 px-8" role="status" aria-live="polite">
  <div class="flex flex-col items-center gap-4 text-center">
    <div class="size-10 animate-spin rounded-full border-2 border-white/20 border-t-white"></div>
    <div class="max-w-sm truncate text-sm font-bold text-white/90">{label}</div>
  </div>
</div>
