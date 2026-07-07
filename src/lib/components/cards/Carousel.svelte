<script lang="ts">
  import type { Snippet } from 'svelte'
  import { dragScroll } from '$lib/nav/actions'
  import { wheelScrollAcross } from '$lib/settings/ui'
  import { gameMode } from '$lib/player/session'
  import ChevronLeft from 'lucide-svelte/icons/chevron-left'
  import ChevronRight from 'lucide-svelte/icons/chevron-right'
  // Game mode (Deck): controller/touch scrolls the row directly, so the mouse-only
  // page arrows are hidden.
  const gm = $derived($gameMode)
  // `viewMoreHref` (optional): renders a "View more" link by the title.
  let { title, viewMoreHref, children }: { title: string; viewMoreHref?: string; children: Snippet } = $props()

  let scroller = $state<HTMLDivElement>()
  let canLeft = $state(false)
  let canRight = $state(false)

  function update() {
    if (!scroller) return
    canLeft = scroller.scrollLeft > 4
    canRight = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4
  }
  // Arrow buttons page ~85% of the visible width, smoothly.
  const page = (dir: number) => scroller?.scrollBy({ left: dir * scroller.clientWidth * 0.85, behavior: 'smooth' })
  // Dismiss any open card hover-preview when the cursor reaches an arrow (SmallCard
  // listens for this), so clicking the arrow never pops the card beneath it.
  const dismissPreview = () => window.dispatchEvent(new Event('carousel-nav'))

  // Mouse wheel over the row → horizontal scroll (a vertical wheel is the desktop
  // default and the scrollbar is hidden app-wide, so without this there's no easy way
  // to scroll right). Native horizontal wheel (deltaX) is left alone; at the ends we
  // release back to the page so vertical page-scroll still works.
  function onWheel(e: WheelEvent) {
    if (!$wheelScrollAcross) return // opt-in (Settings → Interface); arrows otherwise
    if (!scroller || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    const atStart = scroller.scrollLeft <= 0
    const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1
    if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return
    scroller.scrollLeft += e.deltaY
    e.preventDefault()
  }

  // Keep arrow visibility in sync with content (cards load async) + viewport resize.
  $effect(() => {
    if (!scroller) return
    update()
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    const mo = new MutationObserver(update)
    mo.observe(scroller, { childList: true })
    return () => { ro.disconnect(); mo.disconnect() }
  })
</script>

<section class="group/carousel relative mb-8">
  <div class="mb-2 flex items-baseline justify-between px-8">
    <h2 class="text-lg font-black">{title}</h2>
    {#if viewMoreHref}
      <a href={viewMoreHref} data-focusable
         class="flex items-center gap-0.5 text-xs font-bold text-muted-foreground opacity-0 transition hover:text-foreground group-hover/carousel:opacity-100">
        View more <ChevronRight size={14} />
      </a>
    {/if}
  </div>
  <div class="relative">
    <div bind:this={scroller} use:dragScroll onwheel={onWheel} onscroll={update}
         class="flex gap-3 overflow-x-scroll px-8 pb-2">
      {@render children()}
    </div>

    <!-- Edge arrows: appear on hover, only when there's more to scroll that way.
         z-[60] sits ABOVE the card hover-preview (z-50) so the preview can't intercept
         the click; entering an arrow dismisses any open preview so it doesn't pop the
         card underneath. -->
    {#if canLeft && !gm}
      <button aria-label="Scroll left" onclick={() => page(-1)} onpointerenter={dismissPreview}
              class="absolute left-2 top-[45%] z-[60] grid size-9 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/70 text-white opacity-0 shadow-lg backdrop-blur transition hover:bg-black/90 group-hover/carousel:opacity-100">
        <ChevronLeft size={20} />
      </button>
    {/if}
    {#if canRight && !gm}
      <button aria-label="Scroll right" onclick={() => page(1)} onpointerenter={dismissPreview}
              class="absolute right-2 top-[45%] z-[60] grid size-9 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/70 text-white opacity-0 shadow-lg backdrop-blur transition hover:bg-black/90 group-hover/carousel:opacity-100">
        <ChevronRight size={20} />
      </button>
    {/if}
  </div>
</section>
