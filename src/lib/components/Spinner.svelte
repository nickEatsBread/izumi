<script lang="ts">
  // The app's one loading spinner: a faint ring with the primary colour on its top edge, or with
  // `inline` a ring in the surrounding text colour for use inside buttons and coloured overlays.
  // Reduced motion needs nothing here: app.css stops every animation under it. `loading-spinner`
  // steps the turn in Game mode, where a smooth spin repaints the Deck's screen every frame.
  //
  // `player` is playback's loading ring, from the press to the first frame and on later stalls. Every
  // loading screen on the way mounts its own at the same colour, on-screen size and wall-clock turn,
  // so no screen swap restarts or resizes it. On the Deck the old chain (card ring, bar, white ring,
  // accent ring) read as four loaders. It turns on the compositor (will-change), so it keeps moving
  // while source and player setup hold the UI thread.
  import { gameMode, playing } from '$lib/player/session'
  import { uiScale } from '$lib/settings/ui'
  import { deckWebviewZoom } from '$lib/deck/webview-zoom'
  import { themePresentation } from '$lib/themes/runtime'

  let { size = 'sm', label = '', inline = false, class: className = '' }: {
    /** 12, 16, 20 or 32 px, or `player`: playback's loading ring, see above. */
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'player'
    /** Announced to screen readers; leave empty when visible text beside it already says it. */
    label?: string
    inline?: boolean
    class?: string
  } = $props()

  const SIZES = { xs: 'size-3', sm: 'size-4', md: 'size-5', lg: 'size-8' }
  // The ring in screen pixels: 84 across with a 4.5 px stroke, a faint track and a quarter arc in the
  // accent colour on top, one smooth turn a second. That is a 56 px ring with a 3 px border at the
  // reference handheld app's 1.5 scale, where it read as big and calm.
  const RING_PX = 84
  const RING_STROKE_PX = 4.5
  // A screen pixel is a CSS pixel at the player's 1:1 page zoom; the browse zoom that is still on while a
  // source connects would enlarge the ring, so it is drawn smaller by the same factor.
  const zoom = $derived($gameMode ? deckWebviewZoom($uiScale, $playing) : 1)
  const ringPx = $derived(size === 'player' ? RING_PX / zoom : 0)
  // The accent named as CSS for the browser to resolve: white without a theme on the TV surface, else
  // the theme's player.seekbarColor, else its primary. Reading the computed colours here forced a
  // whole-page style pass on every mount, as did asking for its animations.
  const ringColor = $derived(size !== 'player' ? ''
    : typeof document === 'undefined' || document.documentElement.dataset.surface !== 'tv' ? '#fff'
    : $themePresentation?.player?.seekbarColor ? 'var(--theme-seekbar-color)' : 'hsl(var(--primary))')
  // The turn starts where the wall clock is in its second: a negative delay, set once, costs the
  // browser nothing, and no screen swap restarts the turn.
  const turnDelay = `${-(Date.now() % 1000)}ms`
</script>

{#if size === 'player'}
  <!-- Spins on the compositor (will-change), so it stays smooth while source and player setup hold the
       UI thread; an endless animation never ends, so it never drops its layer and blinks. -->
  <span
    data-part="spinner"
    data-variant="player"
    role={label ? 'img' : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : 'true'}
    class="block shrink-0 animate-spin rounded-full will-change-transform {className}"
    style:width="{ringPx}px"
    style:height="{ringPx}px"
    style:border="{RING_STROKE_PX / zoom}px solid rgb(255 255 255 / 0.15)"
    style:border-top-color={ringColor}
    style:animation-delay={turnDelay}
  ></span>
{:else}
  <span
    data-part="spinner"
    role={label ? 'status' : undefined}
    aria-hidden={label ? undefined : 'true'}
    class="loading-spinner inline-block shrink-0 animate-spin rounded-full border-2 {SIZES[size]} {inline ? 'border-current border-t-transparent' : 'border-foreground/15 border-t-primary'} {className}"
  >{#if label}<span class="sr-only">{label}</span>{/if}</span>
{/if}
