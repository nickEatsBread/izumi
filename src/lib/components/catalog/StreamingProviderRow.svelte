<script lang="ts">
  import { goto } from '$app/navigation'
  import { onDestroy } from 'svelte'
  import type { CatalogHomeFeature, CatalogHomeSection } from '$lib/catalog/types'
  import { streamingBrand, type StreamingBrand } from '$lib/catalog/streaming-brands'
  import Carousel from '$lib/components/cards/Carousel.svelte'

  let { section, title = section.title }: { section: CatalogHomeSection; title?: string } = $props()

  type ActiveProvider = CatalogHomeFeature & { brand: StreamingBrand }
  let active = $state<ActiveProvider | null>(null)
  let transitionTimer: ReturnType<typeof setTimeout> | undefined

  function brandStyle(name: string) {
    const brand = streamingBrand(name)
    return `--service-primary:${brand.primary};--service-secondary:${brand.secondary}`
  }

  function openProvider(feature: CatalogHomeFeature) {
    if (!feature.href || active) return
    active = { ...feature, brand: streamingBrand(feature.title) }
    transitionTimer = setTimeout(() => void goto(feature.href!), 430)
  }

  onDestroy(() => clearTimeout(transitionTimer))
</script>

<Carousel {title} attribution={section.attribution}>
  {#each section.features ?? [] as feature (feature.id)}
    <button
      type="button"
      data-focusable
      aria-label={`Open ${feature.title}`}
      onclick={() => openProvider(feature)}
      class="provider-card group relative flex h-36 w-52 shrink-0 flex-col items-start justify-between overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-4 text-left shadow-sm transition duration-300 ease-out hover:-translate-y-1 hover:border-[color:var(--service-primary)] focus-visible:-translate-y-1 focus-visible:border-[color:var(--service-primary)] sm:w-60"
      style={brandStyle(feature.title)}
    >
      <span class="provider-glow pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"></span>
      {#if feature.image}
        <span class="relative grid size-16 place-items-center overflow-hidden rounded-[1.05rem] bg-white/95 shadow-xl ring-1 ring-white/15">
          <img
            src={feature.image}
            alt=""
            loading="lazy"
            decoding="async"
            class="provider-logo size-full object-cover transition duration-300 group-hover:scale-105 group-hover:grayscale-0 group-hover:saturate-100 group-focus-visible:scale-105 group-focus-visible:grayscale-0 group-focus-visible:saturate-100"
          />
        </span>
      {/if}
      <span class="relative max-w-full truncate text-sm font-black tracking-tight text-foreground">{feature.title}</span>
    </button>
  {/each}
</Carousel>

{#if active}
  <div
    class="provider-transition motion-{active.brand.motion} pointer-events-none fixed inset-0 z-[200] grid place-items-center overflow-hidden bg-background"
    style={`--service-primary:${active.brand.primary};--service-secondary:${active.brand.secondary}`}
    aria-live="polite"
  >
    <span class="transition-wash absolute inset-0"></span>
    <span class="transition-orbit absolute size-64 rounded-full border-2 border-[color:var(--service-primary)] opacity-0"></span>
    <span class="transition-sweep absolute inset-y-0 -left-1/2 w-1/2 skew-x-[-16deg]"></span>
    <span class="relative z-10 flex flex-col items-center gap-4 animate-[provider-logo-in_0.4s_ease-out_both]">
      {#if active.image}<img src={active.image} alt="" class="size-20 rounded-2xl bg-white object-cover shadow-2xl" />{/if}
      <span class="text-lg font-black tracking-tight text-white drop-shadow-lg">{active.title}</span>
    </span>
  </div>
{/if}

<style>
  .provider-glow {
    background:
      radial-gradient(circle at 24% 18%, color-mix(in srgb, var(--service-primary) 24%, transparent), transparent 42%),
      linear-gradient(135deg, color-mix(in srgb, var(--service-secondary) 16%, transparent), transparent 70%);
  }
  .provider-logo { filter: grayscale(1) saturate(0) brightness(1.12); }
  .provider-card:hover,
  .provider-card:focus-visible {
    box-shadow: 0 16px 38px color-mix(in srgb, var(--service-primary) 18%, transparent);
  }
  .provider-transition { animation: provider-transition-in 0.43s ease-out both; }
  .transition-wash {
    background: radial-gradient(circle, color-mix(in srgb, var(--service-primary) 58%, black), var(--service-secondary) 45%, #050509 78%);
    animation: provider-wash-in 0.43s ease-out both;
  }
  .motion-pulse .transition-wash { animation: provider-pulse 0.43s ease-out both; }
  .motion-arc .transition-orbit { opacity: 0.75; border-left-color: transparent; animation: provider-orbit 0.43s ease-out both; }
  .motion-wave .transition-sweep { background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--service-primary) 75%, white), transparent); animation: provider-sweep 0.43s ease-out both; }
  .motion-bloom .transition-wash { animation: provider-bloom 0.43s ease-out both; }
  .motion-rise .transition-wash { transform-origin: bottom; animation: provider-rise 0.43s ease-out both; }
  .motion-orbit .transition-orbit { opacity: 0.8; animation: provider-orbit 0.43s cubic-bezier(.2,.8,.2,1) both; }

  @keyframes provider-transition-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes provider-wash-in { from { opacity: 0; transform: scale(1.2); } to { opacity: 1; transform: scale(1); } }
  @keyframes provider-logo-in { from { opacity: 0; transform: scale(.75); } to { opacity: 1; transform: scale(1); } }
  @keyframes provider-pulse { 0% { opacity: 0; transform: scale(.7); } 65% { opacity: 1; transform: scale(1.08); } 100% { transform: scale(1); } }
  @keyframes provider-orbit { from { transform: rotate(-130deg) scale(.35); } to { transform: rotate(90deg) scale(3.4); opacity: 0; } }
  @keyframes provider-sweep { from { transform: translateX(-25vw) skewX(-16deg); } to { transform: translateX(275vw) skewX(-16deg); } }
  @keyframes provider-bloom { from { opacity: 0; clip-path: circle(0 at 50% 50%); } to { opacity: 1; clip-path: circle(75% at 50% 50%); } }
  @keyframes provider-rise { from { opacity: 0; transform: scaleY(0); } to { opacity: 1; transform: scaleY(1); } }

  @media (prefers-reduced-motion: reduce) {
    .provider-card, .provider-logo, .provider-glow { transition-duration: 0.01ms; }
    .provider-transition, .transition-wash, .transition-orbit, .transition-sweep,
    .provider-transition :global(*) { animation-duration: 0.01ms !important; }
  }
</style>
