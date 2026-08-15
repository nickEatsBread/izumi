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
  import { sourceLoaderMotion as motion } from './source-loader-motion'
  import { gameMode, playing } from '$lib/player/session'

  let { title = '', caption = 'Connecting', detail = '', onCancel }: {
    title?: string
    caption?: string
    detail?: string
    onCancel?: () => void
  } = $props()

  // The OS asking for less motion is not a request for a static lottie — it is a request for the
  // animation not to run. It still renders one frame, so the screen keeps its shape and its text.
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // SVG animation mutates a tiny pair of rectangle attributes. That is cheap on Desktop, but in Gamescope it
  // invalidates the full WebKit surface and competes with mpv on the Deck iGPU — so game mode swaps
  // in the transform-only CSS bar instead (same left-right motion, compositor-cheap).
  //
  // That contention only exists while mpv is actually rendering, which on the route INTO playback it
  // is not: this screen is the whole picture until the first frame arrives. Gating on `$playing` as
  // well keeps the cheap ring exactly where it was bought — a mid-playback source change, where the
  // video is live behind this overlay — and gives the Deck the same loader as the desktop everywhere
  // before the player opens.
  const cheapSpinner = $derived($gameMode && $playing)

</script>

<div class="flex w-full max-w-xl flex-col items-center gap-6 px-6 text-center">
  {#if title}
    <h1 class="text-3xl font-black leading-tight tracking-tight text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)] sm:text-4xl">
      {title}
    </h1>
  {/if}

  {#if cheapSpinner}
    <div class="grid h-28 w-52 place-items-center" aria-hidden="true">
      <div class="bar-loader h-1.5 w-40 rounded-full bg-white/20"></div>
    </div>
  {:else}
    <!-- Literal transcription of source-loader.json: same 800×600 composition, 540×10 track,
         clipped moving bar, 30fps/26-frame loop, keyframe easing and final one-frame hold. -->
    <svg class="h-28 w-52" viewBox={motion.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <clipPath id="source-loader-track-clip">
          <path d={motion.clipPath} />
        </clipPath>
      </defs>
      <rect x={motion.track.x} y={motion.track.y} width={motion.track.width}
        height={motion.track.height} fill={motion.track.fill} />
      <g clip-path="url(#source-loader-track-clip)">
        <g transform="translate(107 300)">
          {#if !reduced}
            <animateTransform attributeName="transform" type="translate" dur={motion.duration}
              repeatCount="indefinite" calcMode="spline" keyTimes={motion.positionKeyTimes}
              keySplines={motion.positionKeySplines} values={motion.positionValues} />
          {/if}
          <rect x="-36" y="-5" width="72" height="10" fill={motion.bar.fill} opacity={motion.bar.opacity}>
            {#if !reduced}
              <animate attributeName="x" dur={motion.duration} repeatCount="indefinite"
                calcMode="spline" keyTimes={motion.sizeKeyTimes} keySplines={motion.sizeKeySplines}
                values={motion.halfWidthValues} />
              <animate attributeName="width" dur={motion.duration} repeatCount="indefinite"
                calcMode="spline" keyTimes={motion.sizeKeyTimes} keySplines={motion.sizeKeySplines}
                values={motion.widthValues} />
            {/if}
          </rect>
        </g>
      </g>
    </svg>
  {/if}

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
