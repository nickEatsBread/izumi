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
      class="provider-card brand-{brand.id} motion-{brand.motion} group relative aspect-[2/1] w-64 shrink-0 overflow-hidden rounded-2xl border border-white/12 text-left shadow-lg transition duration-300 ease-out hover:-translate-y-1 hover:scale-[1.018] hover:border-[color:var(--service-primary)] focus-visible:-translate-y-1 focus-visible:scale-[1.018] focus-visible:border-[color:var(--service-primary)] sm:w-80"
      style={`--service-primary:${brand.primary};--service-secondary:${brand.secondary}`}
    >
      <span class="provider-backdrop pointer-events-none absolute inset-0"></span>
      <span class="provider-scene pointer-events-none absolute inset-0" aria-hidden="true">
        <span class="scene-a absolute"></span>
        <span class="scene-b absolute"></span>
      </span>
      <span class="provider-identity pointer-events-none absolute inset-0 z-10 grid place-items-center p-5">
        {#if brand.mark}
          <img src={brand.mark} alt="" class="provider-mark size-full object-contain" />
        {:else}
          <span class="provider-name max-w-full truncate text-xl font-black tracking-tight text-white">{feature.title}</span>
        {/if}
      </span>
      <span class="provider-frame pointer-events-none absolute inset-0 z-20 rounded-[inherit] ring-1 ring-inset ring-white/10"></span>
      <span class="sr-only">{feature.title}</span>
    </button>
  {/each}
</Carousel>

{#if active}
  <div
    class="provider-transition brand-{active.brand.id} motion-{active.brand.motion} pointer-events-none fixed inset-0 z-[200] grid place-items-center overflow-hidden bg-background"
    style={`--service-primary:${active.brand.primary};--service-secondary:${active.brand.secondary}`}
    aria-live="polite"
  >
    <span class="transition-wash absolute inset-0"></span>
    <span class="transition-orbit absolute size-64 rounded-full border-2 border-[color:var(--service-primary)] opacity-0"></span>
    <span class="transition-sweep absolute inset-y-0 -left-1/2 w-1/2 skew-x-[-16deg]"></span>
    <span class="relative z-10 flex w-56 flex-col items-center gap-4 animate-[provider-logo-in_0.4s_ease-out_both] sm:w-72">
      {#if active.brand.mark}
        <img src={active.brand.mark} alt="" class="transition-mark h-28 w-full object-contain drop-shadow-2xl" />
      {:else}
        <span class="text-3xl font-black tracking-tight text-white drop-shadow-lg">{active.title}</span>
      {/if}
    </span>
  </div>
{/if}

<style>
  .provider-card {
    isolation: isolate;
    background: linear-gradient(145deg, #202127, #0d0e12 74%);
  }
  .provider-backdrop {
    background:
      radial-gradient(circle at 50% 110%, color-mix(in srgb, var(--service-primary) 18%, transparent), transparent 56%),
      linear-gradient(145deg, rgb(255 255 255 / .055), transparent 45%);
    opacity: .62;
    transition: opacity 320ms ease, background 320ms ease;
  }
  .provider-scene {
    opacity: 0;
    transform: scale(.98);
    transition: opacity 320ms ease, transform 520ms cubic-bezier(.2,.8,.2,1);
  }
  .provider-mark {
    max-height: 72%;
    max-width: 74%;
    opacity: .9;
    filter: grayscale(1) brightness(0) invert(1);
    transform: scale(.96);
    transition: filter 420ms ease, opacity 300ms ease, transform 520ms cubic-bezier(.2,.8,.2,1);
  }
  .provider-card:hover,
  .provider-card:focus-visible {
    box-shadow: 0 20px 48px color-mix(in srgb, var(--service-primary) 27%, transparent);
  }
  .provider-card:hover .provider-backdrop,
  .provider-card:focus-visible .provider-backdrop { opacity: 1; }
  .provider-card:hover .provider-scene,
  .provider-card:focus-visible .provider-scene { opacity: 1; transform: scale(1); }
  .provider-card:hover .provider-mark,
  .provider-card:focus-visible .provider-mark {
    filter: grayscale(0) brightness(1.35) saturate(1.12);
    opacity: 1;
    transform: scale(1.055);
  }
  .brand-netflix .provider-mark,
  .brand-netflix:hover .provider-mark,
  .brand-netflix:focus-visible .provider-mark { filter: none; }
  .brand-apple-tv:hover .provider-mark,
  .brand-apple-tv:focus-visible .provider-mark { filter: grayscale(1) brightness(0) invert(1); }

  /* Netflix: red light ribbons and a central flare echo its familiar opening ident. */
  .brand-netflix .provider-backdrop {
    background: radial-gradient(circle at 50% 52%, rgb(229 9 20 / .22), transparent 42%), linear-gradient(145deg, #211114, #08090c 72%);
  }
  .brand-netflix .scene-a {
    inset: -28%;
    background: repeating-linear-gradient(80deg, transparent 0 12%, rgb(229 9 20 / .07) 14%, rgb(229 9 20 / .72) 16%, transparent 19% 27%);
    mix-blend-mode: screen;
    animation: netflix-ribbons 1.9s ease-in-out infinite;
  }
  .brand-netflix .scene-b {
    inset: 0;
    background: radial-gradient(ellipse at 50% 100%, rgb(229 9 20 / .68), transparent 63%);
    animation: service-breathe 1.8s ease-in-out infinite alternate;
  }

  /* Disney+: a luminous arc and small star field sit behind the wordmark. */
  .brand-disney .provider-backdrop {
    background: radial-gradient(ellipse at 50% 105%, rgb(4 214 200 / .38), transparent 58%), linear-gradient(145deg, #071b3d, #03101f 76%);
  }
  .brand-disney .scene-a {
    inset: -62% 4% 25%;
    border-radius: 50%;
    border-top: 2px solid rgb(132 255 248 / .9);
    filter: drop-shadow(0 0 10px rgb(4 214 200 / .8));
    transform: rotate(-7deg);
    animation: disney-arc 2.5s ease-in-out infinite;
  }
  .brand-disney .scene-b {
    inset: 9%;
    background: radial-gradient(circle at 15% 28%, white 0 1px, transparent 2px), radial-gradient(circle at 78% 22%, white 0 1px, transparent 2px), radial-gradient(circle at 88% 70%, rgb(139 255 249) 0 1px, transparent 2px), radial-gradient(circle at 28% 76%, white 0 1px, transparent 2px);
    animation: disney-stars 1.8s ease-in-out infinite alternate;
  }

  /* Prime Video: the smile becomes the primary motion, with a cyan light sweep. */
  .brand-prime-video .provider-backdrop {
    background: radial-gradient(ellipse at 50% 115%, rgb(0 168 225 / .48), transparent 62%), linear-gradient(145deg, #092839, #07131c 76%);
  }
  .brand-prime-video .scene-a {
    inset: 56% 13% -43%;
    border-radius: 50%;
    border-top: 3px solid rgb(79 209 255 / .9);
    filter: drop-shadow(0 0 8px rgb(0 168 225 / .8));
    animation: prime-smile 2.1s ease-in-out infinite;
  }
  .brand-prime-video .scene-b {
    inset: -25% -70%;
    background: linear-gradient(112deg, transparent 40%, rgb(89 219 255 / .56) 49%, transparent 58%);
    mix-blend-mode: screen;
    animation: service-wave 2.3s ease-in-out infinite;
  }

  /* Apple TV: a restrained spectral bloom against the monochrome mark. */
  .brand-apple-tv .provider-backdrop { background: linear-gradient(145deg, #25252a, #09090b 78%); }
  .brand-apple-tv .scene-a {
    inset: -60%;
    border-radius: 50%;
    background: conic-gradient(from 35deg, rgb(72 188 255 / .52), rgb(162 92 255 / .48), rgb(255 99 144 / .44), rgb(255 188 75 / .4), rgb(72 188 255 / .52));
    filter: blur(34px);
    animation: apple-spectrum 5s linear infinite;
  }
  .brand-apple-tv .scene-b {
    inset: 0;
    background: radial-gradient(circle, rgb(255 255 255 / .26), transparent 58%);
    animation: service-breathe 2s ease-in-out infinite alternate;
  }

  /* Hulu: vertical broadcast bands rise into its signature green. */
  .brand-hulu .provider-backdrop { background: linear-gradient(145deg, #082c1b, #07110c 78%); }
  .brand-hulu .scene-a {
    inset: 10% -8% -12%;
    transform-origin: bottom;
    background: repeating-linear-gradient(90deg, transparent 0 8%, rgb(28 231 131 / .18) 8% 13%, transparent 13% 18%);
    animation: hulu-levels 1.7s ease-in-out infinite alternate;
  }
  .brand-hulu .scene-b {
    inset: 0;
    background: linear-gradient(to top, rgb(28 231 131 / .48), transparent 72%);
    animation: service-breathe 1.9s ease-in-out infinite alternate;
  }

  /* Max: soft blue-violet lens rings create depth without fighting the wordmark. */
  .brand-max .provider-backdrop { background: radial-gradient(circle at 50% 64%, rgb(47 85 255 / .44), transparent 48%), linear-gradient(145deg, #160b4a, #080817 78%); }
  .brand-max .scene-a {
    inset: -36% 8%;
    border-radius: 50%;
    border: 2px solid rgb(118 139 255 / .76);
    box-shadow: 0 0 42px rgb(47 85 255 / .58), inset 0 0 32px rgb(137 80 255 / .3);
    animation: max-orbit 2.8s ease-in-out infinite;
  }
  .brand-max .scene-b {
    inset: 18%;
    border-radius: 50%;
    border: 1px solid rgb(170 111 255 / .5);
    animation: max-orbit 2.8s ease-in-out infinite reverse;
  }

  .brand-crunchyroll .provider-backdrop { background: radial-gradient(circle at 72% 42%, rgb(244 117 33 / .45), transparent 38%), linear-gradient(145deg, #331407, #100906 76%); }
  .brand-crunchyroll .scene-a {
    inset: -45% 11%;
    border-radius: 50%;
    border: 3px solid rgb(255 147 73 / .78);
    border-left-color: transparent;
    border-bottom-color: transparent;
    filter: drop-shadow(0 0 11px rgb(244 117 33 / .7));
    animation: service-orbit 2.5s linear infinite;
  }
  .brand-crunchyroll .scene-b { inset: 0; background: radial-gradient(circle at 70% 44%, rgb(255 206 172 / .34), transparent 28%); }

  .brand-paramount-plus .provider-backdrop { background: radial-gradient(circle at 50% 65%, rgb(0 100 255 / .46), transparent 52%), linear-gradient(145deg, #071e59, #050c22 78%); }
  .brand-paramount-plus .scene-a {
    inset: 9%;
    background: radial-gradient(circle at 14% 30%, white 0 1px, transparent 2px), radial-gradient(circle at 84% 26%, white 0 1px, transparent 2px), radial-gradient(circle at 75% 78%, white 0 1px, transparent 2px), radial-gradient(circle at 28% 72%, white 0 1px, transparent 2px), radial-gradient(circle at 48% 14%, white 0 1px, transparent 2px);
    animation: disney-stars 1.9s ease-in-out infinite alternate;
  }
  .brand-paramount-plus .scene-b {
    inset: -45% 15%;
    border-radius: 50%;
    border: 1px solid rgb(135 177 255 / .7);
    animation: max-orbit 3.2s ease-in-out infinite;
  }

  .brand-peacock .provider-backdrop { background: linear-gradient(145deg, #24211a, #090909 78%); }
  .brand-peacock .scene-a {
    inset: -20%;
    background: linear-gradient(90deg, transparent 8%, rgb(252 204 18 / .4), rgb(255 113 18 / .36), rgb(239 21 65 / .36), rgb(110 85 220 / .36), rgb(6 157 224 / .36), rgb(5 172 63 / .36), transparent 92%);
    filter: blur(18px);
    animation: peacock-colour 2.4s ease-in-out infinite alternate;
  }
  .brand-peacock .scene-b { inset: 0; background: radial-gradient(circle, rgb(255 255 255 / .18), transparent 58%); }

  .brand-generic .scene-a {
    inset: -25% -70%;
    background: linear-gradient(112deg, transparent 39%, color-mix(in srgb, var(--service-primary) 58%, white) 49%, transparent 59%);
    animation: service-wave 2.3s ease-in-out infinite;
  }

  .provider-transition { animation: provider-transition-in .43s ease-out both; }
  .transition-mark { filter: brightness(0) invert(1); }
  .brand-netflix .transition-mark { filter: none; }
  .transition-wash {
    background: radial-gradient(circle, color-mix(in srgb, var(--service-primary) 58%, black), var(--service-secondary) 45%, #050509 78%);
    animation: provider-wash-in .43s ease-out both;
  }
  .motion-pulse .transition-wash { animation: provider-pulse .43s ease-out both; }
  .motion-arc .transition-orbit { opacity: .75; border-left-color: transparent; animation: provider-orbit .43s ease-out both; }
  .motion-wave .transition-sweep { background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--service-primary) 75%, white), transparent); animation: provider-sweep .43s ease-out both; }
  .motion-bloom .transition-wash { animation: provider-bloom .43s ease-out both; }
  .motion-rise .transition-wash { transform-origin: bottom; animation: provider-rise .43s ease-out both; }
  .motion-orbit .transition-orbit { opacity: .8; animation: provider-orbit .43s cubic-bezier(.2,.8,.2,1) both; }

  @keyframes provider-transition-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes provider-wash-in { from { opacity: 0; transform: scale(1.2); } to { opacity: 1; transform: scale(1); } }
  @keyframes provider-logo-in { from { opacity: 0; transform: scale(.75); } to { opacity: 1; transform: scale(1); } }
  @keyframes provider-pulse { 0% { opacity: 0; transform: scale(.7); } 65% { opacity: 1; transform: scale(1.08); } 100% { transform: scale(1); } }
  @keyframes provider-orbit { from { transform: rotate(-130deg) scale(.35); } to { transform: rotate(90deg) scale(3.4); opacity: 0; } }
  @keyframes provider-sweep { from { transform: translateX(-25vw) skewX(-16deg); } to { transform: translateX(275vw) skewX(-16deg); } }
  @keyframes provider-bloom { from { opacity: 0; clip-path: circle(0 at 50% 50%); } to { opacity: 1; clip-path: circle(75% at 50% 50%); } }
  @keyframes provider-rise { from { opacity: 0; transform: scaleY(0); } to { opacity: 1; transform: scaleY(1); } }
  @keyframes netflix-ribbons { 0%, 100% { transform: translateX(-7%) scaleY(.78); opacity: .42; } 50% { transform: translateX(7%) scaleY(1.1); opacity: .96; } }
  @keyframes disney-arc { 0%, 100% { transform: rotate(-7deg) translateX(-3%); opacity: .55; } 50% { transform: rotate(-4deg) translateX(3%); opacity: 1; } }
  @keyframes disney-stars { from { opacity: .32; transform: scale(.96); } to { opacity: 1; transform: scale(1.03); } }
  @keyframes prime-smile { 0%, 100% { transform: translateY(10%) scaleX(.86); opacity: .4; } 50% { transform: translateY(-7%) scaleX(1.04); opacity: 1; } }
  @keyframes apple-spectrum { to { transform: rotate(360deg); } }
  @keyframes hulu-levels { from { transform: scaleY(.32); opacity: .35; } to { transform: scaleY(1.08); opacity: .95; } }
  @keyframes max-orbit { 0%, 100% { transform: scale(.84); opacity: .38; } 50% { transform: scale(1.08); opacity: .9; } }
  @keyframes peacock-colour { from { transform: translateX(-12%) scale(.86); opacity: .35; } to { transform: translateX(12%) scale(1.12); opacity: .9; } }
  @keyframes service-breathe { from { opacity: .26; transform: scale(.86); } to { opacity: .92; transform: scale(1.14); } }
  @keyframes service-wave { 0%, 100% { transform: translateX(-18%); opacity: .24; } 50% { transform: translateX(18%); opacity: .9; } }
  @keyframes service-orbit { to { transform: rotate(360deg); } }

  @media (prefers-reduced-motion: reduce) {
    .provider-card, .provider-mark, .provider-scene { transition-duration: .01ms; }
    .provider-scene :global(*) { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
    .provider-transition, .transition-wash, .transition-orbit, .transition-sweep,
    .provider-transition :global(*) { animation-duration: .01ms !important; }
  }
</style>
