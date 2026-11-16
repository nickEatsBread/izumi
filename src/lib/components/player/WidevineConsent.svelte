<script lang="ts">
  // First protected stream on Linux: izumi needs Google's Widevine module, which it may download
  // but never bundle. This is the player's overlay around the consent card (WidevineConsentPanel):
  // it keeps player hotkeys out and drives the card from a controller, since the player owns input.
  import { onMount } from 'svelte'
  import { listenSafe } from '$lib/util/listen'
  import WidevineConsentPanel from './WidevineConsentPanel.svelte'

  let { onaccepted, ondeclined }: { onaccepted: (version: string) => void; ondeclined: () => void } = $props()

  let root = $state<HTMLElement>()

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ondeclined(); return }
    // Player hotkeys (space, arrows, letters) must not act under the dialog.
    if (e.key.length === 1 || e.key.startsWith('Arrow')) e.stopPropagation()
  }

  onMount(() => {
    // Controller: A confirms the highlighted button, B declines.
    return listenSafe<{ name: string; pressed: boolean }>('gamepad-input', ({ payload }) => {
      if (!payload.pressed) return
      const focused = document.activeElement as HTMLElement | null
      if (payload.name === 'b') ondeclined()
      else if (payload.name === 'a') {
        if (focused && root?.contains(focused) && focused.tagName === 'BUTTON') focused.click()
        else root?.querySelector<HTMLElement>('[data-consent-primary]:not([disabled])')?.click()
      } else if (payload.name === 'up' || payload.name === 'down' || payload.name === 'left' || payload.name === 'right') {
        const buttons = [...(root?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])]
        const at = focused ? buttons.indexOf(focused) : -1
        const delta = payload.name === 'up' || payload.name === 'left' ? -1 : 1
        buttons[(at + delta + buttons.length) % buttons.length]?.focus({ preventScroll: true })
      }
    })
  })
</script>

<div
  bind:this={root}
  role="dialog"
  aria-modal="true"
  aria-label="Protected video"
  data-nav-trap
  data-widevine-consent
  tabindex="-1"
  class="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
  onkeydown={onKey}
  onclick={(e) => e.stopPropagation()}
>
  <WidevineConsentPanel purpose="play" {onaccepted} {ondeclined} />
</div>
