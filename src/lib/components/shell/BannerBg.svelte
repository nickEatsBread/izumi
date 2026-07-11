<script lang="ts">
  import { heroMedia } from '$lib/stores/hero'
  import { banner } from '$lib/anilist/media'

  // The shared, full-bleed banner that sits behind the sidebar + content.
  // Driven by the heroMedia store; renders nothing when null (solid bg shows).
  const src = $derived($heroMedia ? banner($heroMedia) : '')
</script>

{#if $heroMedia && src}
  <div class="pointer-events-none fixed inset-x-0 top-0 -z-20 h-[55vh] w-full">
    {#key $heroMedia.id}
      <img
        src={src}
        alt=""
        class="absolute inset-0 h-full w-full animate-[fade_0.6s_ease] object-cover opacity-35"
        style="object-position:center 20%"
      />
    {/key}
    <!-- Fade to the app background at the bottom so content blends in. -->
    <div class="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-background/10"></div>
    <!-- Subtle left fade so the translucent sidebar blends over the banner. -->
    <div class="absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-background/70 to-transparent"></div>
  </div>
{/if}
