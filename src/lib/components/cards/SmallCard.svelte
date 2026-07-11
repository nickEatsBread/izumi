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
  import { title, cover, season, format } from '$lib/anilist/media'
  import { fade } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { get } from 'svelte/store'
  import { gameMode } from '$lib/player/session'
  import { isMobile } from '$lib/platform'
  import PreviewCard from './PreviewCard.svelte'
  let { media }: { media: Media } = $props()

  let hovered = $state(false)
  let pos = $state({ left: 0, top: 0 })
  let el: HTMLElement
  let closeT: ReturnType<typeof setTimeout>
  const dot = (m: Media) => m.status === 'RELEASING' ? '#3db4f2' : m.status === 'NOT_YET_RELEASED' ? '#f79a63' : '#7bd555'

  // Preview is rendered `fixed` (escapes the carousel's overflow clipping) and
  // clamped to the viewport so it never gets cut off by the sidebar or edges.
  const PW = 280, PH = 340, SIDEBAR = 64
  function place() {
    const r = el.getBoundingClientRect()
    const left = Math.max(SIDEBAR, Math.min(r.left + r.width / 2 - PW / 2, window.innerWidth - PW - 8))
    const top = Math.max(8, Math.min(r.top - 16, window.innerHeight - PH - 8))
    pos = { left, top }
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

<div bind:this={el} class="w-[152px] shrink-0" onpointerenter={open} onpointerleave={scheduleClose} role="presentation">
  <a href={`/app/anime/${media.id}`} data-focusable class="load-in group block w-[152px]">
    <div class="focus-cover h-[228px] w-[152px] overflow-hidden rounded-md bg-muted">
      <!-- No `transform-gpu`/`will-change`: those permanently promote EVERY cover to its own
           GPU layer (hundreds on a grid → the Deck iGPU thrashes + lag accumulates). The
           browser promotes the one card being hovered on demand; that's all this needs. -->
      <img src={cover(media)} alt={title(media)} decoding="async" loading="lazy"
           class="h-full w-full object-cover transition-transform duration-150 ease-out group-hover:scale-105" />
    </div>
    <div class="mt-1 line-clamp-2 text-[0.8rem] font-black leading-tight">
      <span class="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={`background:${dot(media)}`}></span>{title(media)}
    </div>
    <div class="mt-0.5 flex justify-between text-[0.7rem] text-muted-foreground">
      <span>{season(media)}</span><span>{format(media)}</span>
    </div>
  </a>
</div>

{#if hovered}
  <div class="pointer-events-auto fixed z-50 will-change-[transform,opacity]" style={`left:${pos.left}px;top:${pos.top}px`}
       in:fade={{ duration: 140, easing: cubicOut }} out:fade={{ duration: 120, easing: cubicOut }}
       onpointerenter={keepOpen} onpointerleave={scheduleClose} role="presentation">
    <PreviewCard {media} />
  </div>
{/if}
