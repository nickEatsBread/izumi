<script lang="ts">
  import { glyphFor, type GlyphButton, type GlyphFamily } from '$lib/nav/glyphs'
  // One controller button as its printed label: round for face buttons, a pill for bumpers, triggers
  // and the menu buttons. Plain text and CSS only, no vendor artwork.
  let { family, button }: { family: GlyphFamily; button: GlyphButton } = $props()
  const face = $derived(glyphFor(family, button))
</script>

<span data-part="hints.glyph" data-button={button} data-family={family} role="img" aria-label={face.name}
  class="inline-grid h-6 shrink-0 place-items-center bg-foreground px-1.5 text-sm font-black leading-none text-background {face.shape === 'round' ? 'min-w-6 rounded-full' : 'min-w-8 rounded-md'}">{face.text}</span>
