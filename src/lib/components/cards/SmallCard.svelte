<script module lang="ts">
  // ONE shared carousel-nav suppressor for ALL cards. Previously every card added its own
  // `carousel-nav` window listener — hundreds on a big grid, all firing per event. This single
  // module-level listener blocks a preview from popping for 500ms after a carousel arrow scrolls
  // a card under the cursor. (Date.now is browser-only here; guard for SSR.)
  let suppressedUntil = 0
  if (typeof window !== 'undefined') {
    window.addEventListener('carousel-nav', () => { suppressedUntil = Date.now() + 500 })
  }
</script>

<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { reliableImage } from '$lib/util/reliable-image'
  import { title, cardCover, season, format, mediaHref } from '$lib/anilist/media'
  import { rememberDetail } from '$lib/anilist/detail-hint'
  import { fade } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { get } from 'svelte/store'
  import { gameMode } from '$lib/player/session'
  import { isAndroid, isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'
  import PreviewCard from './PreviewCard.svelte'
  import { previewPos, rootZoom } from './preview-pos'
  import { portal } from '$lib/util/portal'
  // `fill`: fill the parent's width (for a responsive grid cell) instead of the fixed carousel
  // width. Used by the 3-up browse grid so tiles reach the screen edges (no dead right margin).
  let { media, fill = false }: { media: Media; fill?: boolean } = $props()

  let hovered = $state(false)
  // The card's own painted width, so cardCover can pick the smallest asset that still covers it:
  // `w-36` against the 14.5px mobile root is ~131px, the `sm:` carousel tile is 152px. A fill-width
  // grid cell has no fixed width to state, so it gets the safe (larger) asset.
  const coverWidth = $derived(fill ? 0 : $isMobile ? 131 : 152)
  const coverSrc = $derived(cardCover(media, coverWidth))
  let coverReady = $state(false)
  $effect(() => { void coverSrc; coverReady = false })
  let pos = $state({ left: 0, top: 0 })
  let el: HTMLElement
  let closeT: ReturnType<typeof setTimeout>
  const dot = (m: Media) => m.status === 'RELEASING' ? '#3db4f2' : m.status === 'NOT_YET_RELEASED' ? '#f79a63' : '#7bd555'

  // Preview is rendered `fixed` (escapes the carousel's overflow clipping) and clamped to the
  // viewport so it never gets cut off by the sidebar or edges. The math is zoom-aware — see
  // preview-pos.ts for why the UI-scale setting otherwise throws the popup off by that factor.
  function place() {
    const r = el.getBoundingClientRect()
    pos = previewPos(r, { width: window.innerWidth, height: window.innerHeight }, rootZoom())
  }
  // Hovercard bridge: opening cancels any pending close; leaving the card (or the
  // preview) schedules a short delayed close so the pointer can travel card→preview
  // without dismissing it. `keepOpen` (preview enter) cancels that pending close.
  // `suppressed` blocks opening for a beat after a carousel arrow is used, so
  // clicking an arrow (which scrolls a card under the cursor) can't pop a preview.
  // Game mode (Deck) and mobile: no hover-trailer previews — touch has no real hover (a tap
  // fires pointerenter and would strand the popup), and the autoplaying trailer is a PC-only
  // affordance.
  function open() { if (get(gameMode) || get(isMobile) || Date.now() < suppressedUntil) return; clearTimeout(closeT); place(); hovered = true }
  function scheduleClose() { clearTimeout(closeT); closeT = setTimeout(() => (hovered = false), 60) }
  function keepOpen() { clearTimeout(closeT) }

  // A scroll dismisses the open preview so it can't get stranded. Gate on `hovered` so ONLY the
  // open card (at most one) holds a window scroll listener — NONE in Game mode. A per-card
  // listener meant hundreds firing on every scroll on big grids (the accumulating scroll lag).
  $effect(() => {
    if (!hovered) return
    const close = () => (hovered = false)
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  })
  $effect(() => () => clearTimeout(closeT))
</script>

<div bind:this={el} class={fill ? 'w-full' : 'w-36 shrink-0 sm:w-[152px]'} onpointerenter={open} onpointerleave={scheduleClose} role="presentation">
  <a href={mediaHref(media)} data-focusable onclick={() => { rememberDetail(media); h.tap() }}
     class="group block {fill ? 'w-full' : 'w-36 sm:w-[152px]'} {$isAndroid ? 'android-card-press' : ''}">
    <div class="focus-cover relative aspect-[2/3] w-full overflow-hidden rounded-md bg-muted">
      <!-- No `transform-gpu`/`will-change`: those permanently promote EVERY cover to its own
           GPU layer (hundreds on a grid → the Deck iGPU thrashes + lag accumulates). The
           browser promotes the one card being hovered on demand; that's all this needs. -->
      {#if !coverReady}<div class="absolute inset-0 skeloader"></div>{/if}
      <!-- `loading="lazy"` is load-bearing, not a nicety: ListRow renders EVERY entry of a tracker
           list with no cap, so a large account mounted ~1100 of these and fired ~1100 concurrent
           extraLarge cover fetches at mount. -->
      <img use:reliableImage={coverSrc} alt={title(media)} loading="lazy" decoding="async" onload={() => (coverReady = true)}
           class="relative h-full w-full object-cover transition-[opacity,transform] duration-150 ease-out {coverReady ? 'opacity-100' : 'opacity-0'} group-hover:scale-105" />
    </div>
    <div class="mt-1 line-clamp-2 text-[0.8rem] font-black leading-tight">
      <span class="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={`background:${dot(media)}`}></span>{title(media)}
    </div>
    <div class="mt-0.5 flex justify-between text-[0.7rem] text-muted-foreground">
      <span>{season(media) || media.startDate?.year || ''}</span><span>{format(media)}</span>
    </div>
  </a>
</div>

{#if hovered}
  <!-- use:portal — re-parent to <body>. In place, the row's `.load-in` transform animation makes
       the card wrapper the containing block for this `fixed` popup (offset by the card's origin,
       clipped by the carousel, painted under sibling posters). From <body>, fixed = viewport. -->
  <div use:portal class="pointer-events-auto fixed z-50 will-change-[transform,opacity]" style={`left:${pos.left}px;top:${pos.top}px`}
       in:fade={{ duration: 140, easing: cubicOut }} out:fade={{ duration: 120, easing: cubicOut }}
       onpointerenter={keepOpen} onpointerleave={scheduleClose} role="presentation">
    <PreviewCard {media} />
  </div>
{/if}
