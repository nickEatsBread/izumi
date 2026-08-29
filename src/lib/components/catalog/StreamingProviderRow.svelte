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

  function openProvider(feature: CatalogHomeFeature) {
    if (!feature.href || active) return
    active = { ...feature, brand: streamingBrand(feature.title) }
    transitionTimer = setTimeout(() => void goto(feature.href!), 430)
  }

  onDestroy(() => clearTimeout(transitionTimer))
</script>

<Carousel {title} attribution={section.attribution}>
  {#each section.features ?? [] as feature (feature.id)}
    {@const brand = streamingBrand(feature.title)}
    <button
      type="button"
      data-focusable
      aria-label={`Open ${feature.title}`}
      onclick={() => openProvider(feature)}
      class="provider-card motion-{brand.motion} group relative aspect-[1.86/1] w-60 shrink-0 overflow-hidden rounded-2xl border border-white/15 bg-[color:var(--service-secondary)] text-left shadow-lg transition duration-300 ease-out hover:-translate-y-1 hover:scale-[1.015] hover:border-[color:var(--service-primary)] focus-visible:-translate-y-1 focus-visible:scale-[1.015] focus-visible:border-[color:var(--service-primary)] sm:w-72"
      style={`--service-primary:${brand.primary};--service-secondary:${brand.secondary}`}
    >
      {#if feature.image}
        <img
          src={feature.image}
          alt=""
          loading="lazy"
          decoding="async"
          class="provider-art absolute inset-0 size-full object-cover transition duration-500 ease-out group-hover:scale-[1.04] group-hover:grayscale-0 group-hover:saturate-100 group-focus-visible:scale-[1.04] group-focus-visible:grayscale-0 group-focus-visible:saturate-100"
        />
      {/if}
      <span class="provider-shade pointer-events-none absolute inset-0 transition duration-300"></span>
      <span class="provider-scene pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
        <span class="scene-a absolute"></span>
        <span class="scene-b absolute"></span>
      </span>
      <span class="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10"></span>
      <span class="sr-only">{feature.title}</span>
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
  .provider-art { filter: grayscale(1) saturate(0) brightness(.7); }
  .provider-shade { background: linear-gradient(135deg, rgb(255 255 255 / .05), transparent 42%, rgb(0 0 0 / .18)); }
  .provider-card:hover,
  .provider-card:focus-visible {
    box-shadow: 0 18px 42px color-mix(in srgb, var(--service-primary) 28%, transparent);
  }
  .provider-card:hover .provider-art,
  .provider-card:focus-visible .provider-art { filter: grayscale(0) saturate(1.12) brightness(1.02); }

  .motion-pulse .scene-a {
    inset: -20%;
    background: repeating-linear-gradient(90deg, transparent 0 14%, color-mix(in srgb, var(--service-primary) 45%, transparent) 17%, transparent 21% 31%);
    mix-blend-mode: screen;
    animation: service-pulse-bars 1.8s ease-in-out infinite;
  }
  .motion-pulse .scene-b {
    inset: 0;
    background: radial-gradient(circle, color-mix(in srgb, var(--service-primary) 35%, transparent), transparent 62%);
    animation: service-breathe 1.6s ease-in-out infinite alternate;
  }
  .motion-arc .scene-a {
    inset: -90% -35%;
    border-radius: 50%;
    background: conic-gradient(from 225deg, transparent 0 61%, color-mix(in srgb, var(--service-primary) 90%, white) 69%, transparent 74%);
    mix-blend-mode: screen;
    animation: service-arc 2.8s linear infinite;
  }
  .motion-arc .scene-b {
    inset: 0;
    background: radial-gradient(ellipse at 50% 105%, color-mix(in srgb, var(--service-primary) 55%, transparent), transparent 62%);
    animation: service-breathe 1.8s ease-in-out infinite alternate;
  }
  .motion-wave .scene-a {
    inset: -25% -70%;
    background: linear-gradient(112deg, transparent 37%, color-mix(in srgb, var(--service-primary) 78%, white) 48%, transparent 58%);
    mix-blend-mode: screen;
    animation: service-wave 2.3s ease-in-out infinite;
  }
  .motion-wave .scene-b {
    inset: 58% -10% -30%;
    border-radius: 50%;
    border-top: 3px solid color-mix(in srgb, var(--service-primary) 75%, white);
    filter: blur(.2px);
    animation: service-wave-line 2.3s ease-in-out infinite;
  }
  .motion-bloom .scene-a {
    inset: -35%;
    background: radial-gradient(circle, rgb(255 255 255 / .56), transparent 57%);
    mix-blend-mode: screen;
    animation: service-bloom 2s ease-in-out infinite alternate;
  }
  .motion-bloom .scene-b {
    inset: 0;
    background: linear-gradient(120deg, transparent 28%, rgb(255 255 255 / .24), transparent 67%);
    animation: service-shimmer 2.4s ease-in-out infinite;
  }
  .motion-rise .scene-a {
    inset: 0;
    transform-origin: bottom;
    background: linear-gradient(to top, color-mix(in srgb, var(--service-primary) 68%, transparent), transparent 72%);
    animation: service-rise 1.8s ease-in-out infinite alternate;
  }
  .motion-rise .scene-b {
    inset: 35% -20% -45%;
    border-radius: 50%;
    border-top: 2px solid color-mix(in srgb, var(--service-primary) 75%, white);
    animation: service-wave-line 2.1s ease-in-out infinite;
  }
  .motion-orbit .scene-a {
    inset: -40% 8%;
    border-radius: 50%;
    border: 3px solid color-mix(in srgb, var(--service-primary) 75%, white);
    border-left-color: transparent;
    border-bottom-color: transparent;
    filter: drop-shadow(0 0 12px var(--service-primary));
    animation: service-orbit 2.4s linear infinite;
  }
  .motion-orbit .scene-b {
    inset: 12%;
    border-radius: 50%;
    background: radial-gradient(circle at 78% 18%, white 0 2px, transparent 3px), radial-gradient(circle at 18% 76%, white 0 1px, transparent 2px);
    animation: service-orbit 3.4s linear infinite reverse;
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
  @keyframes service-pulse-bars { 0%, 100% { transform: translateX(-8%) scaleY(.75); opacity: .35; } 50% { transform: translateX(8%) scaleY(1.15); opacity: .9; } }
  @keyframes service-breathe { from { opacity: .25; transform: scale(.85); } to { opacity: .9; transform: scale(1.15); } }
  @keyframes service-arc { to { transform: rotate(360deg); } }
  @keyframes service-wave { 0%, 100% { transform: translateX(-18%); opacity: .25; } 50% { transform: translateX(18%); opacity: .9; } }
  @keyframes service-wave-line { 0%, 100% { transform: translateY(8%) scaleX(.85); opacity: .35; } 50% { transform: translateY(-12%) scaleX(1.08); opacity: .95; } }
  @keyframes service-bloom { from { opacity: .25; transform: scale(.65); } to { opacity: .95; transform: scale(1.25); } }
  @keyframes service-shimmer { 0%, 100% { transform: translateX(-45%); } 50% { transform: translateX(45%); } }
  @keyframes service-rise { from { opacity: .35; transform: scaleY(.35); } to { opacity: .95; transform: scaleY(1.1); } }
  @keyframes service-orbit { to { transform: rotate(360deg); } }

  @media (prefers-reduced-motion: reduce) {
    .provider-card, .provider-art, .provider-scene { transition-duration: 0.01ms; }
    .provider-scene :global(*) { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
    .provider-transition, .transition-wash, .transition-orbit, .transition-sweep,
    .provider-transition :global(*) { animation-duration: 0.01ms !important; }
  }
</style>
