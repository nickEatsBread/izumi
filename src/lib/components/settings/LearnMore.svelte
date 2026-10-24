<script lang="ts">
  // `label` is the row title: every row has a Learn more, so each button needs its own name.
  let { text, label }: { text: string; label: string } = $props()
  let open = $state(false)
  const id = $props.id()
</script>

<!-- Opens on click, tap or A only: a pad or a TV remote cannot hover. -->
<button type="button" data-focusable data-touch-target aria-expanded={open} aria-controls={id} aria-label="Learn more about {label}"
        onclick={() => (open = !open)}
        class="inline-flex items-center text-xs font-semibold text-muted-foreground underline underline-offset-2 sm:hover:text-foreground">Learn more</button>
{#if open}<p {id} class="mt-1 text-xs text-muted-foreground">{text}</p>{/if}
