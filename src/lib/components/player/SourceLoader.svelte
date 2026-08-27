<script lang="ts">
  // The screen between "you picked a source" and "video is playing".
  //
  // That gap used to be dead: the picker greyed its own rows out and nothing else happened until
  // either the player appeared or, after a grace period, the debrid caching screen did. On a slow
  // resolve it read as a freeze.
  //
  // Layout is title → animation → status → release, over a blurred still of the show's own
  // artwork. izumi has no clear-art logo layer, so the title renders as text, which is the same
  // fallback the shape is borrowed from.
  let { title = '', caption = 'Connecting', detail = '', onCancel }: {
    title?: string
    caption?: string
    detail?: string
    onCancel?: () => void
  } = $props()

</script>

<div class="flex w-full max-w-xl flex-col items-center gap-6 px-6 text-center">
  {#if title}
    <h1 class="text-3xl font-black leading-tight tracking-tight text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)] sm:text-4xl">
      {title}
    </h1>
  {/if}

  <!-- Transform-only and explicitly compositor-promoted in app.css. Unlike the old SVG/SMIL
       transcription, this keeps moving while source and native-player setup occupy the UI thread. -->
  <div class="grid h-28 w-52 place-items-center" aria-hidden="true">
    <div class="bar-loader h-1 w-40 rounded-full bg-white/20"></div>
  </div>

  <!-- `w-full min-w-0` is load-bearing: the column centres its children rather than stretching them,
       so `max-w-md` (28rem) sized the detail line to 448px on a ~360px portrait phone and the release
       name ran off the screen edge. `truncate` was already there and could not help — it clips
       INSIDE the box, and the box itself was the thing overflowing. Bounded to the parent, it
       ellipsizes as intended. -->
  <div class="w-full min-w-0 space-y-2">
    <p class="text-xs font-bold uppercase tracking-[0.36em] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">{caption}</p>
    {#if detail}
      <p class="mx-auto w-full max-w-md truncate text-sm text-white/75" {title}>{detail}</p>
    {/if}
  </div>

  {#if onCancel}
    <button
      data-focusable
      onclick={onCancel}
      class="rounded-full border border-white/20 bg-black/40 px-5 py-2 text-xs font-semibold text-white/85 transition-colors hover:bg-black/60 hover:text-white"
    >Cancel</button>
  {/if}
</div>
