<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { fade } from 'svelte/transition'
  import { beforeNavigate } from '$app/navigation'
  import { bumpPlayerOverlay, gameMode, playing } from '$lib/player/session'
  import { portal } from '$lib/util/portal'
  import { revealAboveKeyboard } from '$lib/nav'
  import { closeOsk, oskBackspace, oskDone, oskEcho, oskInsert, oskSession, startOsk } from '$lib/nav/osk'

  // The built-in on-screen keyboard: Steam Deck Game mode (the Steam keyboard cannot be summoned
  // reliably from the sandboxed Flatpak under gamescope), a phone or desktop driven by a pad, and
  // Android TV. Every rule lives in $lib/nav/osk.ts: when it opens (A on a field, never d-pad focus,
  // except on TV), typing, Done, closing and where focus goes. This component only draws the keys for
  // the open session. It is portalled to <body> at z-190: above every dialog, the select chooser (175)
  // and the exit prompt (170); below only the intro ident and the fatal alert (200).

  let shift = $state(false)
  let symbols = $state(false)
  let root = $state<HTMLElement>()

  // Rows. The symbols layer swaps the letters for punctuation; a numeric field gets a keypad.
  const LETTERS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  ]
  const SYMS = [
    ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
    ['-', '_', '=', '+', '[', ']', '{', '}', ';', ':'],
    ['/', '\\', '|', '<', '>', ',', '.', '?'],
    ['~', '`', "'", '"', '£', '€', '¥'],
  ]
  const DIGITS = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['.', '0', '-'],
  ]
  const numeric = $derived($oskSession?.layout === 'numeric')
  const rows = $derived(numeric ? DIGITS : symbols ? SYMS : LETTERS)
  const cap = (c: string) => (shift && !symbols && !numeric ? c.toUpperCase() : c)
  // What the keys type into. A number draft replaces the session object on every key, so the
  // open/reveal effect keys on this, not on the session.
  const target = $derived($oskSession ? ($oskSession.kind === 'field' ? $oskSession.field : $oskSession.remote) : null)

  function type(ch: string) {
    oskInsert(cap(ch))
    if (shift && !symbols) shift = false // one-shot shift, like a phone keyboard
  }

  onMount(() => startOsk())
  beforeNavigate(() => closeOsk({ restore: false }))

  // A new session: reset the layers, move controller focus onto the keys and lift the field above
  // the docked panel. The reveal's padding is undone when the session ends.
  $effect(() => {
    const current = target
    if (!current) return
    shift = false
    symbols = false
    let undo = () => {}
    const frame = requestAnimationFrame(() => {
      root?.querySelector<HTMLElement>('[data-focusable]')?.focus({ preventScroll: true })
      if (current instanceof HTMLElement && root) undo = revealAboveKeyboard(current, root.getBoundingClientRect().top)
    })
    // Game mode during playback: the keys reach the screen only through the player's snapshot.
    // Take one more once the fade-in has painted.
    const settle = setTimeout(() => { if (get(gameMode) && get(playing)) bumpPlayerOverlay() }, 140)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settle)
      undo()
    }
  })
  // A layer switch repaints every key.
  $effect(() => {
    void shift
    void symbols
    if (get(gameMode) && get(playing)) bumpPlayerOverlay()
  })
</script>

{#if $oskSession}
  <!-- data-osk marks the keyboard for the nav engine and the outside-press closers; data-nav-trap
       keeps the d-pad on the keys. B, Escape and remote Back close it (osk.ts). -->
  <div
    use:portal
    bind:this={root}
    data-osk
    data-nav-trap
    in:fade={{ duration: 120 }}
    out:fade={{ duration: 120 }}
    class="fixed inset-x-0 bottom-0 z-[190] select-none border-t border-white/10 bg-neutral-950/95 px-4 pb-6 pt-4 shadow-2xl"
    role="group"
    aria-label="On-screen keyboard"
  >
    {#if $oskEcho}
      <!-- What the field holds now, since the keyboard may cover it (masked for passwords). -->
      <div aria-hidden="true" class="mx-auto mb-3 flex max-w-4xl items-baseline gap-2 rounded-lg bg-white/5 px-4 py-2 text-white">
        {#if $oskEcho.label}<span class="shrink-0 text-sm font-semibold text-white/60">{$oskEcho.label}:</span>{/if}
        <span class="min-w-0 truncate font-mono text-lg">{$oskEcho.value}</span>
      </div>
    {/if}
    <div class="mx-auto flex max-w-4xl flex-col items-center gap-2">
      {#each rows as row, r (r)}
        <div class="flex justify-center gap-2">
          {#if r === rows.length - 1 && !numeric}
            <button type="button" data-focusable aria-label="Shift" onclick={() => (shift = !shift)}
                    class="grid h-14 min-w-16 place-items-center rounded-lg bg-white/10 px-3 text-lg font-bold outline-none {shift ? 'bg-white text-black' : ''}">⇧</button>
          {/if}
          {#each row as ch (ch)}
            <button type="button" data-focusable onclick={() => type(ch)}
                    class="grid h-14 w-14 place-items-center rounded-lg bg-white/10 text-xl font-bold outline-none">{cap(ch)}</button>
          {/each}
          {#if r === rows.length - 1}
            <button type="button" data-focusable aria-label="Backspace" onclick={oskBackspace}
                    class="grid h-14 min-w-16 place-items-center rounded-lg bg-white/10 px-3 text-xl font-bold outline-none">⌫</button>
          {/if}
        </div>
      {/each}
      <!-- Bottom row: symbols toggle · space · done (a keypad has only Done). -->
      <div class="flex w-full max-w-2xl justify-center gap-2">
        {#if !numeric}
          <button type="button" data-focusable onclick={() => (symbols = !symbols)}
                  class="grid h-14 min-w-24 place-items-center rounded-lg bg-white/10 px-4 text-base font-bold outline-none">{symbols ? 'ABC' : '?123'}</button>
          <button type="button" data-focusable onclick={() => type(' ')}
                  class="h-14 flex-1 rounded-lg bg-white/10 text-sm font-semibold text-white/60 outline-none">space</button>
        {/if}
        <button type="button" data-focusable onclick={oskDone}
                class="grid h-14 min-w-24 place-items-center rounded-lg bg-theme px-4 text-base font-black text-white outline-none">Done</button>
      </div>
    </div>
  </div>
{/if}
