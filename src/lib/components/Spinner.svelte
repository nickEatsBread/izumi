<script lang="ts">
  // The app's one loading spinner: a faint ring with the primary colour on its top edge, or with
  // `inline` a ring in the surrounding text colour for use inside buttons and coloured overlays.
  // Reduced motion needs nothing here: app.css stops every animation under it. `loading-spinner`
  // steps the turn in Game mode, where a smooth spin repaints the Deck's screen every frame.
  //
  // `player` is playback's loading ring, from the press to the first frame and on later stalls: a copy
  // of the one mpv draws in Game mode (gm_osd.rs loading_overlay), which covers the page once mpv's
  // window is up. Every loading screen on the way mounts its own, so each matches mpv's colour,
  // on-screen size, 24 steps a second and wall-clock turn (gm_osd.rs spinner_phase): no screen swap
  // restarts or resizes it. On the Deck the old chain (card ring, bar, white ring, mpv's accent ring)
  // read as four loaders. It turns on the compositor (will-change), so it keeps moving while source
  // and player setup hold the UI thread.
  import { gameMode, playing } from '$lib/player/session'
  import { uiScale } from '$lib/settings/ui'
  import { deckWebviewZoom } from '$lib/deck/webview-zoom'
  import { themePresentation } from '$lib/themes/runtime'

  let { size = 'sm', label = '', inline = false, frame, class: className = '' }: {
    /** 12, 16, 20 or 32 px, or `player`: mpv's loading ring, see above. */
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'player'
    /** Announced to screen readers; leave empty when visible text beside it already says it. */
    label?: string
    inline?: boolean
    /** A turn stepped by the caller (0–7, 45° each) where CSS animation time cannot be trusted to
     *  advance, such as a Game mode surface captured frame by frame. */
    frame?: number
    class?: string
  } = $props()

  const SIZES = { xs: 'size-3', sm: 'size-4', md: 'size-5', lg: 'size-8' }
  // mpv's ring in its own ASS pixels: 24 segments from radius 24 to 31, the head opaque at the top and
  // each one behind it (anticlockwise) fading by the same ASS alphas, 00 to D8.
  const RING = Array.from({ length: 24 }, (_, i) =>
    [1, 0.95, 0.9, 0.84, 0.75, 0.65, 0.55, 0.43, 0.31, 0.22, 0.15][Math.min((24 - i) % 24, 10)])
  // An ASS pixel is a CSS pixel at the player's 1:1 page zoom; the browse zoom that is still on
  // while a source connects would enlarge the ring, so it is drawn smaller by the same factor.
  const ringPx = $derived(size === 'player' ? 64 / ($gameMode ? deckWebviewZoom($uiScale, $playing) : 1) : 0)
  // mpv's colour (readGmOsdTheme's choice) named as CSS for the browser to resolve: white without a
  // theme on the TV surface, else the theme's player.seekbarColor, else its primary. Reading the
  // computed colours here forced a whole-page style pass on every mount, as did asking for its animations.
  const ringColor = $derived(size !== 'player' ? ''
    : typeof document === 'undefined' || document.documentElement.dataset.surface !== 'tv' ? '#fff'
    : $themePresentation?.player?.seekbarColor ? 'var(--theme-seekbar-color)' : 'hsl(var(--primary))')
  // The turn starts where the wall clock is in its second (mpv picks the nearest segment while CSS
  // steps round down, so half a step ahead): a negative delay, set once, costs the browser nothing.
  const turnDelay = `${-((Date.now() + 1000 / 48) % 1000)}ms`
</script>

{#if size === 'player'}
  <svg
    data-part="spinner"
    data-variant="player"
    role={label ? 'img' : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : 'true'}
    viewBox="-32 -32 64 64"
    width={ringPx}
    height={ringPx}
    class="shrink-0 animate-spin will-change-transform {className}"
    style:color={ringColor}
    style:animation-timing-function="steps(24)"
    style:animation-delay={turnDelay}
  >
    {#each RING as opacity, i (i)}
      <line x1="0" y1="-24" x2="0" y2="-31" stroke="currentColor" stroke-width="2.5" {opacity} transform="rotate({i * 15})" />
    {/each}
  </svg>
{:else}
  <span
    data-part="spinner"
    role={label ? 'status' : undefined}
    aria-hidden={label ? undefined : 'true'}
    class="loading-spinner inline-block shrink-0 rounded-full border-2 {SIZES[size]} {inline ? 'border-current border-t-transparent' : 'border-foreground/15 border-t-primary'} {className}"
    class:animate-spin={frame == null}
    style:transform={frame == null ? undefined : `rotate(${frame * 45}deg)`}
  >{#if label}<span class="sr-only">{label}</span>{/if}</span>
{/if}
