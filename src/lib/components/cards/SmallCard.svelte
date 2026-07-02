<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { title, cover, season, format } from '$lib/anilist/media'
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
  function open() { clearTimeout(closeT); place(); hovered = true }
  function scheduleClose() { clearTimeout(closeT); closeT = setTimeout(() => (hovered = false), 120) }
  function keepOpen() { clearTimeout(closeT) }

  // Any scroll (page or a carousel) dismisses the preview so it can't get stranded.
  $effect(() => {
    const close = () => { if (hovered) hovered = false }
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('scroll', close, true); clearTimeout(closeT) }
  })
</script>

<div bind:this={el} class="w-[152px] shrink-0" onpointerenter={open} onpointerleave={scheduleClose} role="presentation">
  <a href={`/app/anime/${media.id}`} data-focusable class="load-in group block w-[152px]">
    <div class="h-[228px] w-[152px] overflow-hidden rounded-md bg-muted">
      <img src={cover(media)} alt={title(media)} loading="lazy"
           class="h-full w-full object-cover transition group-hover:scale-105" />
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
  <div class="pointer-events-auto fixed z-50" style={`left:${pos.left}px;top:${pos.top}px`}
       onpointerenter={keepOpen} onpointerleave={scheduleClose} role="presentation">
    <PreviewCard {media} />
  </div>
{/if}
