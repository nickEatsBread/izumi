<script lang="ts">
  // Mount a component from a dynamic import, so its code (and everything it statically pulls in)
  // stays OUT of the eager boot bundle. Gate the surrounding {#if} on whatever store makes the
  // component relevant; the module then loads on first use and the browser caches it, so a
  // second open is instant. This is how the whole player stack (PlayerOverlay, AndroidPlayer,
  // StreamPicker, and lottie-web via SourceLoader — ~30% of the app JS) is kept off first paint.
  import { untrack } from 'svelte'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { load, props = {} }: { load: () => Promise<{ default: any }>; props?: Record<string, unknown> } = $props()
  // Resolve the module ONCE per mount. `untrack` makes that a guarantee rather than a bet on how
  // eagerly Svelte re-evaluates a template expression: calling `load()` inside `{#await}` would
  // re-run if the prop were ever seen as changing, and a fresh promise there re-renders the await
  // block — remounting a component that owns real state (the picker's filter/auto-pick chain, the
  // Android player's whole session). The dynamic import itself is browser-cached, so a later mount
  // resolves instantly.
  const mod = untrack(() => load())
</script>

{#await mod then { default: Component }}
  <Component {...props} />
{/await}
