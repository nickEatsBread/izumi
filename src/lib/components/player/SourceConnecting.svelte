<script lang="ts">
  // The connecting screen, mounted app-wide rather than inside the source picker.
  //
  // It used to live in the picker, which meant it only existed when the picker did — so Continue
  // Watching and binge continuation, which both resolve with the picker closed, fell straight
  // through to the debrid caching screen even when debrid was not what they were waiting on. This
  // covers every route into playback, and the caching screen is left to mean what it says.
  import { connecting, debridCaching, gameMode, playing } from '$lib/player/session'
  import SourceLoader from './SourceLoader.svelte'
  import Spinner from '$lib/components/Spinner.svelte'
  import AndroidConnectionStatus from './AndroidConnectionStatus.svelte'
  import { fade } from 'svelte/transition'
  import { isAndroid } from '$lib/platform'
  import { gmPanel, gmPanelOut } from '$lib/player/gm-freeze'
  import { motion } from '$lib/motion/gm-motion'
  import LoadingScreen from '$lib/components/themes/LoadingScreen.svelte'
  import { themePresentation } from '$lib/themes/runtime'
  import { episodeLoadingModel } from '$lib/themes/host-model'

  const c = $derived($connecting)
  // API 8 `loading.episode`: the theme's screen under the ring until the player's cover takes over.
  const episodeScreen = $derived($themePresentation?.loading?.episode)
  // Past two seconds the loader names what it is waiting on.
  let slow = $state(false)
  $effect(() => {
    if (!c) { slow = false; return }
    const timer = setTimeout(() => (slow = true), 2_000)
    return () => { clearTimeout(timer); slow = false }
  })
</script>

<!-- Yields to the caching screen: once that is up, debrid genuinely is the wait, and two
     full-screen overlays would fight over the same z-order. -->
{#if c && !$debridCaching}
  {#if $isAndroid}
    <!-- The app layout owns one persistent watch page across picker, connection and playback. -->
    <div transition:fade={{ duration: 100 }}>
      <AndroidConnectionStatus headline="Getting episode ready" detail={c.detail || c.title} oncancel={() => c?.cancel()} />
    </div>
  {:else if $gameMode && $playing}
  <!-- A mid-playback source swap must not replace the current frame with a black loading page.
       This compact card renders live over the paused video's frozen frame (gm-freeze.ts). -->
  <div
    data-slot="play.connecting"
    data-variant="switch"
    data-gm-menu-surface
    class="fixed inset-0 z-[55] grid place-items-center bg-black/45"
    onclick={() => c?.cancel()}
    onkeydown={(e) => e.key === 'Escape' && c?.cancel()}
    role="presentation"
  >
    <div use:gmPanel={'bottom'} out:motion|global={gmPanelOut('bottom')} class="relative w-full max-w-xl rounded-2xl border border-white/10 bg-[#101012]/95 py-6 shadow-2xl" onclick={(e) => e.stopPropagation()} role="presentation">
      <SourceLoader title={c.title} caption="Switching source" detail={c.detail} onCancel={c.cancel} />
    </div>
  </div>
  {:else}
  <!-- The episode is opening: the player's own loader from the press, the one ring on black where the
       player's (and mpv's, in Game mode) appears, so nothing changes until the picture. A separate
       "Connecting" screen with its own art, title and caption read as a stop on the way. -->
  <div
    data-slot="play.connecting"
    data-variant="player"
    class="fixed inset-0 z-[55] grid place-items-center overflow-hidden bg-black"
    onclick={() => c?.cancel()}
    onkeydown={(e) => e.key === 'Escape' && c?.cancel()}
    role="presentation"
    transition:fade={{ duration: $gameMode ? 0 : 160 }}
  >
    <span class="sr-only" role="status">Opening {c.title}</span>
    {#if episodeScreen}<LoadingScreen screen={episodeScreen} episode loading variant="opening" model={episodeLoadingModel(c.media, c.episode, c.title, c.art)} class="absolute inset-0" />{/if}
    <button data-focusable data-part="play.connecting.back" onclick={(e) => { e.stopPropagation(); c?.cancel() }} class="absolute left-6 top-6 z-10 grid size-11 place-items-center rounded-full bg-black/40 text-xl text-white/85 transition-colors hover:bg-white/20 hover:text-white" aria-label="Back">‹</button>
    <div data-part="play.loader" class="grid place-items-center" aria-hidden="true"><Spinner size="player" /></div>
    <!-- A long wait (add-on searches, a slow source) says what it is waiting on, under the ring. -->
    {#if slow && c.detail}
      <p data-part="play.loader.detail" class="pointer-events-none absolute inset-x-0 top-1/2 mt-16 truncate px-8 text-center text-sm text-white/60">{c.detail}</p>
    {/if}
  </div>
  {/if}
{/if}
