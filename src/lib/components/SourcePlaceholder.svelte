<script lang="ts">
  // The ONE stand-in for a source with no artwork of its own: an addon whose manifest declares no
  // logo, a catalog package the repo ships no icon for, or an icon whose host has gone down.
  //
  // There used to be two answers to that. Rows rendered through AddonLogo got a colour-hashed tile
  // with the source's initial, while the store and the extensions list drew this puzzle mark — so
  // the SAME missing icon looked like two different kinds of thing depending on which screen you
  // were on, and the coloured tiles read as real branding sitting next to real logos. This is the
  // survivor; nothing else may invent a fallback.
  //
  // Decorative by design: every call site already names the source in adjacent text (or, inside
  // AddonLogo, on the wrapper that owns the accessible name), so a second announcement would only
  // repeat it.
  import Puzzle from '@lucide/svelte/icons/puzzle'

  let { size = 20 }: { size?: number } = $props()

  // The tile is drawn at whatever size the row asks for, so the corner radius and the glyph have to
  // track it — a fixed `rounded-lg` reads as a circle at 20px and a fixed glyph size leaves a 48px
  // card mostly empty.
  const radius = $derived(Math.max(3, Math.round(size * 0.22)))
  const glyph = $derived(Math.max(10, Math.round(size * 0.52)))
</script>

<span
  aria-hidden="true"
  class="grid shrink-0 place-items-center bg-theme/10 text-theme"
  style="height:{size}px;width:{size}px;border-radius:{radius}px"
>
  <Puzzle size={glyph} />
</span>
