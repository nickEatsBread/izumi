<script lang="ts">
  // The stand-in shown between a Play/episode tap and the real player-flow overlay being ready.
  //
  // It exists because those overlays are lazily imported with the player stack,
  // so on a cold HTTP cache the gate opens and the chunk is still on the network. Everything here is
  // therefore deliberately cheap and EAGERLY bundled: no animation library or images, and one
  // import, Spinner, whose own imports (the session and settings stores) the app shell has already
  // loaded. If this file ever grows another import, check first that it does not drag the very chunk
  // it is covering for into the boot bundle.
  //
  // The markup deliberately MIRRORS SourceLoader (same backdrop, same title, same spinner in the same
  // 28x52 slot on the screen's centre, same tracked caption). On a cold chunk cache it IS the source
  // loader for a second or two, so the real screen replaces this in place and the spinner, which
  // keeps one wall-clock turn across mounts, carries on without a jump.
  import Spinner from './Spinner.svelte'

  let { label, caption = 'Connecting', art = '', variant = 'picker' }: {
    label: string
    caption?: string
    // Passed in by the layout, which already holds the connecting state.
    art?: string
    /** `player`: the episode is opening, so this is the player's own loader (SourceConnecting's), the
     *  ring alone on black. `picker`: the source picker's, with the title and caption. */
    variant?: 'picker' | 'player'
  } = $props()
</script>

{#if variant === 'player'}
  <div data-slot="play.connecting" data-variant="player" class="fixed inset-0 z-50 grid place-items-center bg-black" role="status" aria-label={label ? `Opening ${label}` : 'Opening'}>
    <div data-part="play.loader" class="grid place-items-center" aria-hidden="true"><Spinner size="player" /></div>
  </div>
{:else}

<!-- Same z-index band and same opaque black as the overlays it precedes, so nothing renders on top
     of it and the real screen replaces this in place with no brightness pop. -->
<div data-slot="play.connecting" class="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-black px-8" role="status" aria-live="polite">
  {#if art}
    <!-- Desktop blurs this still; game mode's `loading-backdrop` rule drops the filter, because
         animating over a full-screen filtered layer makes Deck WebKit repaint it every frame. -->
    <img data-part="play.backdrop" src={art} alt="" class="loading-backdrop pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl" />
  {/if}
  <div data-part="play.loader" class="relative grid w-full max-w-xl grid-rows-[1fr_auto_1fr] justify-items-center gap-6 px-6 text-center">
    {#if label}
      <h1 data-part="play.loader.title" class="row-start-1 self-end text-3xl font-black leading-tight tracking-tight text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)] sm:text-4xl">{label}</h1>
    {/if}
    <div data-part="play.loader.bar" class="row-start-2 grid h-28 w-52 place-items-center" aria-hidden="true">
      <Spinner size="player" />
    </div>
    <p data-part="play.loader.caption" class="row-start-3 self-start text-xs font-bold uppercase tracking-[0.36em] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">{caption}</p>
  </div>
</div>
{/if}
