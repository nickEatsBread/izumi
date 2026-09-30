<script lang="ts">
  import { page } from '$app/state'
  import { hintsFor, type HintButton } from '$lib/nav/hints'
  import { findPageTabs } from '$lib/nav/page-tabs'
  import { onPadButton } from '$lib/nav/pad-events'
  import { glyphFamily, lastPadId, rememberPad, type GlyphButton } from '$lib/nav/glyphs'
  import { controllerMode } from '$lib/nav/input'
  import { gameMode, playing } from '$lib/player/session'
  import Glyph from './Glyph.svelte'

  // The controller prompts (`shell.hints`): what A, X, B, the page-tab triggers and the menu button
  // do for whatever holds focus, re-derived on every focus change. Only after pad input in Game or
  // controller mode; the first touch, tap or mouse move hides the bar until the pad is used again.
  let padActive = $state(false)
  let focused = $state<Element | null>(null)
  let pageTabs = $state(false)
  let dialog = $state(false)
  // The layered Back model publishes what B does next on <html> (`data-nav-back-hint`); without it
  // the bar falls back to its own reading of the page.
  let back = $state<string | undefined>()
  const refresh = () => {
    focused = document.activeElement
    pageTabs = findPageTabs() !== null
    dialog = [...document.querySelectorAll<HTMLElement>('[data-nav-trap]')].some((trap) => trap.checkVisibility?.() ?? true)
    back = document.documentElement.dataset.navBackHint || undefined
  }

  $effect(() => onPadButton(({ pressed }) => {
    if (!pressed) return
    rememberPad()
    padActive = true
    refresh()
    // A press can open or close a dialog without moving focus; look again once it has rendered.
    setTimeout(refresh, 300)
    setTimeout(refresh, 900)
  }))
  $effect(() => {
    const hide = () => (padActive = false)
    const onMove = (event: PointerEvent) => { if (event.pointerType === 'mouse' && (event.movementX || event.movementY)) hide() }
    const onFocusOut = () => setTimeout(refresh)
    window.addEventListener('pointerdown', hide, { passive: true })
    window.addEventListener('pointermove', onMove, { passive: true })
    // The Back model announces each change of what B does, including layers opened by touch.
    window.addEventListener('izumi-nav-back-hint', refresh)
    document.addEventListener('focusin', refresh)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      window.removeEventListener('pointerdown', hide)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('izumi-nav-back-hint', refresh)
      document.removeEventListener('focusin', refresh)
      document.removeEventListener('focusout', onFocusOut)
    }
  })
  $effect(() => {
    void page.url.pathname
    refresh()
  })

  const shown = $derived(padActive && ($gameMode || $controllerMode) && !$playing)
  const home = $derived(page.url.pathname.replace(/\/$/, '') === '/app/home')
  const hints = $derived(hintsFor(focused, { home, pageTabs, dialog, back }))
  const family = $derived(glyphFamily($lastPadId, $gameMode))
  const glyphOf = (button: HintButton): GlyphButton => (button === 'l2r2' ? 'l2' : button)

  // While shown, the page keeps the bar's height free at its end, so the last row never sits under it.
  $effect(() => {
    const root = document.documentElement
    if (shown) root.setAttribute('data-theme-hints', '')
    else root.removeAttribute('data-theme-hints')
    return () => root.removeAttribute('data-theme-hints')
  })
</script>

{#if shown && hints.length}
  <div data-slot="hints" role="note" aria-label="Controller buttons" data-theme-surface="shell"
       class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex h-10 items-center justify-end gap-6 border-t border-border/60 bg-background px-6 text-sm font-semibold text-foreground">
    {#each hints as hint (hint.button)}
      <span data-part="hints.item" data-button={hint.button} class="flex items-center gap-2">
        <Glyph {family} button={glyphOf(hint.button)} />{#if hint.button === 'l2r2'}<Glyph {family} button="r2" />{/if}
        <span data-part="hints.label">{hint.label}</span>
      </span>
    {/each}
  </div>
{/if}

<style>
  :global(html[data-theme-hints] body) { padding-bottom: 2.5rem; }
</style>
