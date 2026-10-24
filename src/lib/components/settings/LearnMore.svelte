<script lang="ts">
  // `label` is the row title: every row has a Learn more, so each button needs its own name.
  let { text, label }: { text: string; label?: string } = $props()
  let open = $state(false)
  const id = $props.id()
</script>

<!-- Opens on click, tap or A only: a pad or a TV remote cannot hover.
     `relative` lifts it above the row button (a positioned ripple-host) that its negative top margin overlaps. -->
<button type="button" data-focusable data-touch-target aria-expanded={open} aria-controls={id} aria-label={label ? `Learn more about ${label}` : undefined}
        onclick={() => (open = !open)}
        class="relative inline-flex items-center text-xs font-semibold text-muted-foreground underline underline-offset-2 sm:hover:text-foreground">Learn more</button>
<p {id} hidden={!open} class="mt-1 text-xs text-muted-foreground">{text}</p>
