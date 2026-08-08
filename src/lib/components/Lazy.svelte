<script lang="ts">
  // Mount a component from a dynamic import, so its code (and everything it statically pulls in)
  // stays OUT of the eager boot bundle. Gate the surrounding {#if} on whatever store makes the
  // component relevant; the module then loads on first use and the browser caches it, so a
  // second open is instant. This is how the whole player stack (PlayerOverlay, AndroidPlayer,
  // StreamPicker, and lottie-web via SourceLoader — ~30% of the app JS) is kept off first paint.
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { load, props = {}, pending }: {
    load: () => Promise<{ default: any }>
    props?: Record<string, unknown>
    // Rendered while the import is in flight. Optional, because most lazy mounts are things the
    // user did not ask to see yet — but a mount that IS the user's feedback (a resolve starting, a
    // picker opening) must show something, or the gate opening produces an empty screen for as long
    // as the chunk takes. That window is not small: the picker's graph carries lottie-web, ~300KB,
    // and on a cold HTTP cache (a fresh install, or the first play after an update) it is fetched
    // from the network at the moment of the click. Symptom without this: you tap an episode, get no
    // loading state at all, and land in the video seconds later.
    pending?: Snippet
  } = $props()
  // Resolve the module ONCE per mount. `untrack` makes that a guarantee rather than a bet on how
  // eagerly Svelte re-evaluates a template expression: calling `load()` inside `{#await}` would
  // re-run if the prop were ever seen as changing, and a fresh promise there re-renders the await
  // block — remounting a component that owns real state (the picker's filter/auto-pick chain, the
  // Android player's whole session). The dynamic import itself is browser-cached, so a later mount
  // resolves instantly.
  const mod = untrack(() => load())
</script>

{#await mod}
  {@render pending?.()}
{:then { default: Component }}
  <Component {...props} />
{/await}
