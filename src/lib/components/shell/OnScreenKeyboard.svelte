<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { fade } from 'svelte/transition'
  import { invoke } from '@tauri-apps/api/core'
  import { gameMode, oskOpen } from '$lib/player/session'
  import { uiScale } from '$lib/settings/ui'

  // Game-mode on-screen keyboard (Steam-Deck failover). The Steam OSK can't be reliably summoned
  // from a non-Steam Flatpak under gamescope (SteamAPI init fails in the sandbox, AppID detection
  // is broken, injected keys often don't land) — so we ship our own controller-navigable keyboard,
  // exactly like the crunchy-deck reference. It appears when a text field is focused in Game mode,
  // traps the d-pad (data-nav-trap), and writes straight into the field via the DOM (no perms).
  const gm = $derived($gameMode)

  type Field = HTMLInputElement | HTMLTextAreaElement
  let target: Field | null = $state(null)
  let open = $state(false)
  let shift = $state(false)
  let symbols = $state(false)

  const isTextField = (el: EventTarget | null): el is Field => {
    if (el instanceof HTMLTextAreaElement) return true
    if (el instanceof HTMLInputElement) {
      // Only real text-entry inputs; skip checkbox/range/etc.
      return !['checkbox', 'radio', 'range', 'button', 'submit', 'color'].includes(el.type)
    }
    return false
  }

  // Rows. Symbols layer swaps the letters for punctuation. The bottom row is shared.
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
  const rows = $derived(symbols ? SYMS : LETTERS)
  const cap = (c: string) => (shift && !symbols ? c.toUpperCase() : c)

  function type(ch: string) {
    if (!target) return
    const el = target
    const s = el.selectionStart ?? el.value.length
    const e = el.selectionEnd ?? el.value.length
    el.value = el.value.slice(0, s) + ch + el.value.slice(e)
    const pos = s + ch.length
    try { el.setSelectionRange(pos, pos) } catch { /* some input types disallow selection */ }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    if (shift && !symbols) shift = false // one-shot shift, like a phone keyboard
  }
  function backspace() {
    if (!target) return
    const el = target
    const s = el.selectionStart ?? el.value.length
    const e = el.selectionEnd ?? el.value.length
    if (s === e && s > 0) {
      el.value = el.value.slice(0, s - 1) + el.value.slice(e)
      try { el.setSelectionRange(s - 1, s - 1) } catch { /* ignore */ }
    } else {
      el.value = el.value.slice(0, s) + el.value.slice(e)
      try { el.setSelectionRange(s, s) } catch { /* ignore */ }
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  function submit() {
    // Enter: fire a keydown so search boxes that listen for Enter act, then close.
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    close()
  }
  let closedAt = 0
  function close() {
    open = false
    closedAt = performance.now()
    const t = target
    target = null
    shift = false; symbols = false
    // DESELECT the field (blur) — do NOT refocus, or focusin would immediately re-open the
    // keyboard (the "Done doesn't close it" bug).
    requestAnimationFrame(() => t?.blur())
  }

  // Steam OSK mode from the field: email → 2, numeric/tel/number → 3, textarea → 1, else 0.
  function oskMode(el: Field): number {
    if (el instanceof HTMLTextAreaElement) return 1
    if (el.type === 'email') return 2
    if (el.type === 'number' || el.inputMode === 'numeric' || el.inputMode === 'tel') return 3
    return 0
  }

  // Mirror open-state to the store (drives the controller translator) + move controller focus onto
  // the keys when it opens so the d-pad works immediately.
  $effect(() => { oskOpen.set(open) })
  $effect(() => {
    if (open) requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="On-screen keyboard"] [data-focusable]')?.focus({ preventScroll: true }))
  })

  onMount(() => {
    const onFocusIn = async (e: FocusEvent) => {
      if (!gm) return
      // Ignore focus moving onto the keyboard's own keys, and a re-focus right after Done/close.
      if ((e.target as HTMLElement)?.closest?.('[aria-label="On-screen keyboard"]')) return
      if (performance.now() - closedAt < 400) return
      if (!isTextField(e.target)) return
      const el = e.target as Field
      // Try the Steam Deck OSK first. Its floating keyboard injects OS keystrokes straight into the
      // focused field. Rect is window pixels = CSS px × page-zoom (uiScale × the 1.25 game-mode
      // browse boost) × devicePixelRatio. Only fall back to the built-in keyboard if it declines.
      const r = el.getBoundingClientRect()
      const z = get(uiScale) * 1.25 * (window.devicePixelRatio || 1)
      let shown = false
      try {
        shown = await invoke<boolean>('steam_show_osk', {
          x: Math.round(r.left * z), y: Math.round(r.top * z),
          w: Math.round(r.width * z), h: Math.round(r.height * z),
          mode: oskMode(el),
        })
      } catch { shown = false }
      if (!shown) { target = el; open = true }
    }
    // B (via the controller translator) and Escape close it; fields blur to the keys, so we do NOT
    // close on focusout.
    const onClose = () => close()
    window.addEventListener('focusin', onFocusIn, true)
    window.addEventListener('osk-close', onClose)
    return () => {
      window.removeEventListener('focusin', onFocusIn, true)
      window.removeEventListener('osk-close', onClose)
    }
  })
</script>

{#if open && gm}
  <!-- data-nav-trap: the d-pad stays on the keys; B closes (handled by the app-wide translator via
       a focusable Close, and Escape/Done here). -->
  <div
    data-nav-trap
    transition:fade={{ duration: 120 }}
    class="fixed inset-x-0 bottom-0 z-[80] select-none border-t border-white/10 bg-neutral-950/95 px-4 pb-6 pt-4 shadow-2xl"
    role="group"
    aria-label="On-screen keyboard"
  >
    <div class="mx-auto flex max-w-4xl flex-col items-center gap-2">
      {#each rows as row, r (r)}
        <div class="flex justify-center gap-2">
          {#if r === rows.length - 1}
            <button data-focusable onclick={() => (shift = !shift)}
                    class="grid h-14 min-w-16 place-items-center rounded-lg bg-white/10 px-3 text-lg font-bold outline-none {shift ? 'bg-white text-black' : ''}">⇧</button>
          {/if}
          {#each row as ch (ch)}
            <button data-focusable onclick={() => type(cap(ch))}
                    class="grid h-14 w-14 place-items-center rounded-lg bg-white/10 text-xl font-bold outline-none">{cap(ch)}</button>
          {/each}
          {#if r === rows.length - 1}
            <button data-focusable onclick={backspace}
                    class="grid h-14 min-w-16 place-items-center rounded-lg bg-white/10 px-3 text-xl font-bold outline-none">⌫</button>
          {/if}
        </div>
      {/each}
      <!-- Bottom row: symbols toggle · space · done -->
      <div class="flex w-full max-w-2xl justify-center gap-2">
        <button data-focusable onclick={() => (symbols = !symbols)}
                class="grid h-14 min-w-24 place-items-center rounded-lg bg-white/10 px-4 text-base font-bold outline-none">{symbols ? 'ABC' : '?123'}</button>
        <button data-focusable onclick={() => type(' ')}
                class="h-14 flex-1 rounded-lg bg-white/10 text-sm font-semibold text-white/60 outline-none">space</button>
        <button data-focusable onclick={submit}
                class="grid h-14 min-w-24 place-items-center rounded-lg bg-theme px-4 text-base font-black text-white outline-none">Done</button>
      </div>
    </div>
  </div>
{/if}
