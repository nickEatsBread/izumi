<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import Keyboard from 'lucide-svelte/icons/keyboard'
  import {
    acknowledgeDeckKeyboardWarning,
    deckKeyboardWarning,
    warnBeforeThirdPartyLogin,
  } from '$lib/deck/keyboard-warning'

  let continueButton = $state<HTMLButtonElement>()

  $effect(() => {
    if (!$deckKeyboardWarning) return
    const frame = requestAnimationFrame(() => continueButton?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  })

  onMount(() => {
    let unlisten: (() => void) | null = null
    let disposed = false
    listen<{ label: string; service: string }>('deck-keyboard-warning', (event) => {
      const { label, service } = event.payload
      void warnBeforeThirdPartyLogin(service, true).then((proceed) => {
        if (!disposed) invoke('resolve_deck_login_popup', { label, proceed }).catch(() => {})
      })
    }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  })
</script>

{#if $deckKeyboardWarning}
  <div
    data-nav-trap
    role="dialog"
    aria-modal="true"
    aria-label="Steam keyboard shortcut"
    class="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-5 backdrop-blur-sm"
  >
    <div class="w-full max-w-lg rounded-2xl border border-white/15 bg-[#111318] p-6 text-center text-white shadow-2xl">
      <span class="mx-auto grid size-12 place-items-center rounded-full bg-white/10 text-white"><Keyboard size={24} /></span>
      <h2 class="mt-3 text-xl font-black">Steam keyboard needed</h2>
      <p class="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/70">
        {$deckKeyboardWarning.service} cannot open the keyboard automatically in its sign-in window.
        When you need to type, press these buttons together:
      </p>

      <div class="my-6 flex items-center justify-center gap-4" aria-label="Steam button plus X button">
        <kbd class="inline-flex h-12 min-w-28 items-center justify-center rounded-full border-2 border-white/25 bg-[#171a21] px-5 font-sans text-sm font-black tracking-wide shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.45)]">
          STEAM
        </kbd>
        <span class="text-2xl font-light text-white/45">+</span>
        <kbd class="grid size-12 place-items-center rounded-full border-2 border-white/25 bg-[#171a21] text-lg font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.45)]">X</kbd>
      </div>

      <p class="text-xs text-white/55">Hold the Steam button, then press X.</p>
      <button
        bind:this={continueButton}
        data-focusable
        onclick={acknowledgeDeckKeyboardWarning}
        class="mt-5 w-full rounded-xl bg-white px-5 py-3 text-sm font-black text-black transition-colors hover:bg-white/90"
      >
        Continue to {$deckKeyboardWarning.service}
      </button>
    </div>
  </div>
{/if}
