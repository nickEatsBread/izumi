<script lang="ts">
  import { goto } from '$app/navigation'
  import type { CatalogHomeFeature, CatalogHomeSection } from '$lib/catalog/types'
  import { orderStreamingServices, streamingBrand } from '$lib/catalog/streaming-brands'
  import Carousel from '$lib/components/cards/Carousel.svelte'

  let { section, title = section.title }: { section: CatalogHomeSection; title?: string } = $props()

  let previewId = $state<string | null>(null)
  let previewState = $state<Record<string, 'ready' | 'failed'>>({})
  let failedMarks = $state<Record<string, boolean>>({})
  const features = $derived(orderStreamingServices(section.features ?? []))

  function showPreview(feature: CatalogHomeFeature) {
    if (streamingBrand(feature.title).preview && previewState[feature.id] !== 'failed') previewId = feature.id
  }

  function hidePreview(feature: CatalogHomeFeature) {
    if (previewId === feature.id) previewId = null
  }

  function previewLoaded(id: string) {
    previewState = { ...previewState, [id]: 'ready' }
  }

  function previewFailed(id: string) {
    previewState = { ...previewState, [id]: 'failed' }
  }

  function markFailed(id: string) {
    failedMarks = { ...failedMarks, [id]: true }
  }

  function openProvider(feature: CatalogHomeFeature) {
    if (feature.href) void goto(feature.href)
  }
</script>

<Carousel {title} attribution={section.attribution}>
  {#each features as feature (feature.id)}
    {@const brand = streamingBrand(feature.title)}
    {@const mark = brand.mark ?? feature.image}
    {@const previewVisible = previewId === feature.id && brand.preview && previewState[feature.id] !== 'failed'}
    <button
      type="button"
      data-focusable
      aria-label={`Open ${feature.title}`}
      onclick={() => openProvider(feature)}
      onpointerenter={() => showPreview(feature)}
      onpointerleave={() => hidePreview(feature)}
      onfocus={() => showPreview(feature)}
      onblur={() => hidePreview(feature)}
      class:has-preview={Boolean(brand.preview)}
      class="provider-card brand-{brand.id} group relative aspect-[2/1] w-64 shrink-0 overflow-hidden rounded-xl border border-white/10 text-left transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.01] hover:border-white/25 hover:shadow-xl focus-visible:-translate-y-0.5 focus-visible:scale-[1.01] focus-visible:border-white/30 focus-visible:shadow-xl sm:w-80"
      style={`--service-primary:${brand.primary};--service-secondary:${brand.secondary}`}
    >
      <span class="provider-fallback pointer-events-none absolute inset-0"></span>
      {#if previewVisible}
        <img
          src={brand.preview}
          alt=""
          aria-hidden="true"
          class:preview-ready={previewState[feature.id] === 'ready'}
          class="provider-preview pointer-events-none absolute inset-0 size-full object-cover"
          style:object-position={brand.previewPosition ?? 'center'}
          onload={() => previewLoaded(feature.id)}
          onerror={() => previewFailed(feature.id)}
        />
      {/if}
      <span class="provider-shade pointer-events-none absolute inset-0"></span>
      <span class="provider-identity pointer-events-none absolute inset-0 z-10 grid place-items-center p-5">
        {#if mark && (brand.mark || !failedMarks[feature.id])}
          <img
            src={mark}
            alt=""
            class:provider-mark-remote={!brand.mark}
            class="provider-mark absolute object-contain"
            onerror={() => { if (!brand.mark) markFailed(feature.id) }}
          />
        {:else}
          <span class="provider-name max-w-[82%] text-center text-lg font-black tracking-tight text-white">{feature.title}</span>
        {/if}
      </span>
      <span class="provider-frame pointer-events-none absolute inset-0 z-20 rounded-[inherit] ring-1 ring-inset ring-white/[0.08]"></span>
    </button>
  {/each}
</Carousel>

<style>
  .provider-card {
    isolation: isolate;
    background: #111318;
  }

  .provider-fallback {
    background: linear-gradient(
      145deg,
      color-mix(in srgb, var(--service-secondary) 90%, #0b0d12),
      color-mix(in srgb, var(--service-secondary) 76%, var(--service-primary))
    );
  }

  .brand-disney .provider-fallback { background: linear-gradient(145deg, #102f68, #08172f); }
  .brand-apple-tv .provider-fallback { background: linear-gradient(145deg, #424957, #171b23); }
  .brand-google-play .provider-fallback { background: linear-gradient(145deg, #1b2938, #0d151e); }
  .brand-filmbox-plus .provider-fallback { background: linear-gradient(145deg, #f7f7f6, #d8dbe1); }
  .brand-sun-nxt .provider-fallback { background: linear-gradient(145deg, #59122a, #240712); }

  .provider-preview {
    opacity: 0;
    transform: scale(1.035);
    transition: opacity 220ms ease-out, transform 1.1s ease-out;
  }

  .provider-preview.preview-ready {
    opacity: .88;
    transform: scale(1);
  }

  .provider-shade {
    background: rgb(0 0 0 / .25);
    transition: background-color 200ms ease-out;
  }

  .provider-card.has-preview:hover .provider-shade,
  .provider-card.has-preview:focus-visible .provider-shade { background: rgb(0 0 0 / .38); }

  .provider-name { text-shadow: 0 2px 16px rgb(0 0 0 / .9); }

  .provider-mark {
    display: block;
    inset: 0;
    width: 60%;
    height: 50%;
    margin: auto;
    filter: grayscale(1) brightness(0) invert(1);
    transition: filter 200ms ease-out, transform 200ms ease-out;
  }

  .provider-card:hover .provider-mark,
  .provider-card:focus-visible .provider-mark {
    filter: none;
    transform: scale(1.025);
  }

  .provider-mark-remote {
    width: 46%;
    height: 54%;
    border-radius: .85rem;
    filter: none;
  }

  .brand-netflix .provider-mark {
    width: 26%;
    height: 58%;
    filter: none;
  }

  .brand-disney .provider-mark { width: 64%; height: 58%; }
  .brand-prime-video .provider-mark { width: 48%; height: 54%; }
  .brand-apple-tv .provider-mark { width: 54%; height: 50%; }
  .brand-google-play .provider-mark { width: 34%; height: 64%; }
  .brand-filmbox-plus .provider-mark { width: 68%; height: 66%; }
  .brand-sun-nxt .provider-mark { width: 30%; height: 58%; }
  .brand-hulu .provider-mark { width: 48%; height: 44%; }
  .brand-max .provider-mark { width: 48%; height: 44%; }
  .brand-paramount-plus .provider-mark,
  .brand-crunchyroll .provider-mark,
  .brand-peacock .provider-mark { width: 44%; height: 50%; }

  .brand-disney .provider-mark,
  .brand-prime-video .provider-mark,
  .brand-apple-tv .provider-mark,
  .brand-disney:hover .provider-mark,
  .brand-disney:focus-visible .provider-mark,
  .brand-prime-video:hover .provider-mark,
  .brand-prime-video:focus-visible .provider-mark,
  .brand-apple-tv:hover .provider-mark,
  .brand-apple-tv:focus-visible .provider-mark {
    filter: grayscale(1) brightness(0) invert(1);
  }

  .brand-google-play .provider-mark,
  .brand-filmbox-plus .provider-mark,
  .brand-sun-nxt .provider-mark {
    filter: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .provider-card, .provider-preview, .provider-mark { transition-duration: .01ms; }
  }
</style>
