<script lang="ts">
  import { settingsControllerMode } from '$lib/settings/surface'
  // `label` is the row title: every row has a Learn more, so each button needs its own name.
  // `id` comes from the row, whose focusable names the text with aria-describedby in controller mode.
  let { text, label, id }: { text: string; label?: string; id: string } = $props()
  let open = $state(false)
</script>

{#if $settingsControllerMode}
  <!-- Controller mode (spec §5.1: one-line descriptions, full text on focus): no extra d-pad stop.
       The row's wrapper ([data-learn-more], app.css) shows this text while the row has focus. The row's
       focusables read it as their description (aria-describedby reads hidden text), so aria-hidden
       keeps browse mode from reading it a second time. -->
  <p {id} aria-hidden="true" class="text-xs text-muted-foreground">{text}</p>
{:else}
  <!-- Opens on click, tap or A only: a pad or a TV remote cannot hover.
       `relative` lifts it above the row button (a positioned ripple-host) that its negative top margin overlaps. -->
  <button type="button" data-focusable data-touch-target aria-expanded={open} aria-controls={id} aria-label={label ? `Learn more about ${label}` : undefined}
          onclick={() => (open = !open)}
          class="relative inline-flex items-center text-xs font-semibold text-muted-foreground underline underline-offset-2 sm:hover:text-foreground">Learn more</button>
  <p {id} hidden={!open} class="mt-1 text-xs text-muted-foreground">{text}</p>
{/if}
