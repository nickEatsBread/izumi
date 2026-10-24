<script lang="ts">
  let { text }: { text: string } = $props()
  let open = $state(false)
</script>

<!-- Opens on click, tap or A only: a pad or a TV remote cannot hover. -->
<button type="button" data-focusable aria-expanded={open} onclick={() => (open = !open)}
        class="text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground">Learn more</button>
{#if open}<p class="mt-1 text-xs text-muted-foreground">{text}</p>{/if}
