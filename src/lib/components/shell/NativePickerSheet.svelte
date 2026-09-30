<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { afterNavigate } from '$app/navigation'
  import Check from '@lucide/svelte/icons/check'
  import { gameMode, playing, bumpPlayerOverlay } from '$lib/player/session'
  import { pushNavLayer } from '$lib/nav/layers'
  import {
    nativePicker,
    chooseNativePickerOption,
    closeNativePicker,
    focusPickerRow,
    pickerKeydown,
    refreshNativePicker,
    watchControl,
  } from '$lib/nav/native-picker'

  // The pad's chooser for a native <select>: pad A on a select opens it off TV (padActivate →
  // padOpenPicker); touch and mouse keep the native popup. The rules live in $lib/nav/native-picker
  // (tested in jsdom); this component draws the list and registers the open sheet as the top nav
  // layer, so B, keyboard Escape, preemption and a navigation close it alone. No transition
  // directives: its trap must vanish in the same flush as the store. Not portalled, so Svelte's event
  // delegation still reaches it.

  const picker = $derived($nativePicker)
  const select = $derived($nativePicker?.select ?? null)
  let panel = $state<HTMLElement | null>(null)

  // Over mpv in Game mode the page is only visible through the overlay snapshot, which re-captures
  // on request. The stores are read with get(), so no effect that calls this depends on them.
  function bump() {
    if (get(gameMode) && get(playing)) bumpPlayerOverlay()
  }

  // The open sheet is the top nav layer. It returns focus itself (closeNativePicker), so the layer
  // restores nothing; only Back returns focus, a preemption or navigation does not.
  $effect(() => {
    const node = panel
    if (!node) return
    return pushNavLayer({
      kind: 'native-picker',
      node: () => node,
      close: (reason) => closeNativePicker({ restore: reason === 'back' }),
      restore: 'none',
      opener: get(nativePicker)?.opener ?? null,
    })
  })

  // Per open select: land on the current value, keep the Game-mode snapshot fresh, and follow the
  // select (options changing under the sheet re-read it; the select disabled or gone closes it).
  $effect(() => {
    const control = select
    const node = panel
    if (!control || !node) return
    let cancelled = false
    // Focusing a row runs focusin handlers synchronously; nothing they read may become a dependency
    // of this effect, or a store change would re-run it and move focus back to the current value.
    untrack(() => {
      focusPickerRow(node)
      bump()
    })
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!cancelled) bump() }))
    const timer = setTimeout(() => { if (!cancelled) bump() }, 120)
    const stopWatching = watchControl(control, {
      onOptions: () => {
        refreshNativePicker()
        void tick().then(() => {
          if (cancelled) return
          if (!node.contains(document.activeElement)) focusPickerRow(node)
          bump()
        })
      },
      onGone: () => closeNativePicker({ restore: false }),
    })
    return () => {
      cancelled = true
      clearTimeout(timer)
      stopWatching()
      requestAnimationFrame(() => bump())
    }
  })

  afterNavigate(() => {
    if (get(nativePicker)) closeNativePicker({ restore: false })
  })
</script>

<svelte:window onkeydowncapture={(event) => pickerKeydown(event, panel)} />

{#if picker}
  <div class="fixed inset-0 z-[175] grid place-items-end bg-black/70 sm:place-items-center sm:p-4" role="presentation"
       onpointerdown={(event) => { if (event.target === event.currentTarget) closeNativePicker({ restore: true }) }}>
    <div bind:this={panel} role="dialog" aria-modal="true" aria-labelledby="native-picker-title"
         data-theme-protected data-nav-trap data-nav-escape data-native-picker onfocusin={bump}
         class="flex max-h-[min(80dvh,36rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card text-card-foreground shadow-2xl sm:max-w-md sm:rounded-2xl">
      <h2 id="native-picker-title" class="shrink-0 truncate px-5 pb-2 pt-4 text-base font-bold">{picker.title}</h2>
      <div role="listbox" aria-labelledby="native-picker-title" data-nav-scroll-container
           class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {#each picker.options as entry, index (entry.option)}
          {#if entry.group && entry.group !== picker.options[index - 1]?.group}
            <div role="presentation" class="px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">{entry.group}</div>
          {/if}
          <button type="button" data-focusable data-picker-row data-hint-a="Select" role="option" aria-selected={entry.selected}
                  disabled={entry.disabled} onclick={() => chooseNativePickerOption(entry.option)}
                  class="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-40 {entry.selected ? 'font-bold' : ''}">
            <span class="min-w-0 flex-1 truncate">{entry.label}</span>
            {#if entry.selected}<Check size={16} class="shrink-0 text-primary" />{/if}
          </button>
        {/each}
      </div>
      <div class="shrink-0 border-t border-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button type="button" data-focusable data-picker-row onclick={() => closeNativePicker({ restore: true })}
                class="flex min-h-12 w-full items-center justify-center rounded-lg text-sm font-bold text-muted-foreground transition-colors hover:bg-accent focus-visible:bg-accent">Cancel</button>
      </div>
    </div>
  </div>
{/if}
