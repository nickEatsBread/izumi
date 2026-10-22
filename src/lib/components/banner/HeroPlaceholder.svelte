<script lang="ts">
  import { isMobile } from '$lib/platform'
  import { themePresentation } from '$lib/themes/runtime'

  // Every Home's loading banner takes the box of the hero that will replace it: a theme's template
  // hero is full-bleed at its own height, izumi's own phone card and desktop banner keep their shapes.
  // `home.hero[data-state="loading"]` lets a stylesheet size it like its hero beyond that.
  const heroTheme = $derived($themePresentation?.hero)
  const heroPlaceholderHeight = $derived(($isMobile ? heroTheme?.mobileHeight : heroTheme?.height) ?? 46)
  // As Hero.svelte sizes a template: `banner` on every window, `wide` above a phone (its `bleed`
  // overlap is left to the hero itself).
  const heroPlaceholderScale = $derived(heroTheme?.scale === 'banner' ? 'banner' : !$isMobile && heroTheme?.scale === 'wide' ? 'wide' : undefined)
</script>

{#if heroTheme?.template}
  <div data-slot="home.hero" data-state="loading" data-variant="template" aria-hidden="true" class="relative mb-6 min-h-[24vh] overflow-hidden bg-muted"
       style:height={heroPlaceholderScale ? undefined : `${heroPlaceholderHeight}vh`}
       style:aspect-ratio={heroPlaceholderScale === 'wide' ? '16 / 9' : heroPlaceholderScale === 'banner' ? '5 / 1' : undefined}
       style:min-height={heroPlaceholderScale === 'wide' ? '24rem' : heroPlaceholderScale === 'banner' ? '25rem' : undefined}
       style:max-height={heroPlaceholderScale === 'wide' ? '85vh' : heroPlaceholderScale === 'banner' ? '30rem' : undefined}>
    <div class="absolute inset-0 skeloader"></div>
  </div>
{:else if $isMobile}
  <div data-slot="home.hero" data-state="loading" data-variant="phone" aria-hidden="true" class="relative mx-4 mb-6 h-[46vh] overflow-hidden rounded-2xl bg-muted shadow-xl"
       style:height={heroTheme?.mobileHeight ? `${heroTheme.mobileHeight}vh` : undefined}>
    <div class="absolute inset-0 skeloader"></div>
    <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent"></div>
    <div class="absolute inset-x-0 bottom-0 space-y-3 p-4">
      <div class="h-7 w-3/4 rounded skeloader"></div>
      <div class="h-3 w-1/2 rounded skeloader"></div>
      <div class="grid grid-cols-[1fr_auto] gap-2"><div class="h-11 rounded-lg skeloader"></div><div class="h-11 w-24 rounded-lg skeloader"></div></div>
    </div>
  </div>
{:else}
  <div data-slot="home.hero" data-state="loading" data-variant="desktop" aria-hidden="true" class="relative mb-6 h-[50vh] overflow-hidden bg-muted"
       style:height={heroTheme?.height ? `${heroTheme.height}vh` : undefined}>
    <div class="absolute inset-0 skeloader"></div>
    <div class="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent"></div>
    <div class="absolute bottom-8 left-8 w-[34rem] space-y-4"><div class="h-10 w-4/5 rounded skeloader"></div><div class="h-4 w-2/3 rounded skeloader"></div><div class="h-4 w-full rounded skeloader"></div><div class="h-10 w-48 rounded-lg skeloader"></div></div>
  </div>
{/if}
