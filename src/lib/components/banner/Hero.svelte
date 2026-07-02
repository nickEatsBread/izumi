<script lang="ts">
  import type { Media } from '$lib/anilist/types'
  import { banner, title } from '$lib/anilist/media'
  let { media, onplay }: { media: Media; onplay?: () => void } = $props()
  let scrolled = $state(false)
  function onScroll() { scrolled = (globalThis.scrollY ?? 0) > 100 }
  $effect(() => {
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  })
</script>
<div class="relative mb-6 h-[42vh] w-full overflow-hidden transition-opacity duration-300 {scrolled ? 'opacity-40' : 'opacity-100'}">
  <img src={banner(media)} alt="" class="h-full w-full object-cover" />
  <div class="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"></div>
  <div class="absolute bottom-6 left-8 max-w-xl">
    <h1 class="text-3xl font-black drop-shadow">{title(media)}</h1>
    <div class="mt-3 flex gap-2">
      <button data-focusable onclick={() => onplay?.()} class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">Play</button>
      <button data-focusable class="rounded-md bg-secondary px-4 py-2 font-bold">Info</button>
    </div>
  </div>
</div>
