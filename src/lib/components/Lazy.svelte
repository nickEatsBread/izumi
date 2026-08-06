<script lang="ts">
  // Mount a component from a dynamic import, so its code (and everything it statically pulls in)
  // stays OUT of the eager boot bundle. Gate the surrounding {#if} on whatever store makes the
  // component relevant; the module then loads on first use and the browser caches it, so a
  // second open is instant. This is how the whole player stack (PlayerOverlay, AndroidPlayer,
  // StreamPicker, and lottie-web via SourceLoader — ~30% of the app JS) is kept off first paint.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { load, props = {} }: { load: () => Promise<{ default: any }>; props?: Record<string, unknown> } = $props()
  // `load` is a stable prop, so this await expression evaluates exactly once per mount — the
  // dynamic import fires on first use and the browser caches the module for later mounts.
</script>

{#await load() then { default: Component }}
  <Component {...props} />
{/await}
