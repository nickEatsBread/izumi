<script lang="ts">
  // The main profile's PIN, asked on a restricted profile before a household action (spec §6.5).
  // No text field: a keypad of real buttons, so it needs no on-screen keyboard, IME, controller mode
  // or autofill, and works the same with touch, a mouse, a pad, a TV remote or a keyboard.
  import { onMount, tick } from 'svelte'
  import Delete from '@lucide/svelte/icons/delete'
  import LockKeyhole from '@lucide/svelte/icons/lock-keyhole'
  import { pushNavLayer, topNavLayer } from '$lib/nav/layers'
  import { describeFocus, restoreFocus } from '$lib/nav/focus-memory'
  import { pinLockSeconds, pinThrottleMessage } from '$lib/profiles/store'
  import {
    HOUSEHOLD_ACTION_TITLES,
    HOUSEHOLD_KEYPAD,
    HOUSEHOLD_PIN_MIN,
    cancelHouseholdPrompt,
    householdPrompt,
    pinAfterKey,
    submitHouseholdPin,
    type HouseholdKey,
  } from '$lib/profiles/household-gate'

  let root = $state<HTMLElement>()
  let pin = $state('')
  const prompt = $derived($householdPrompt)
  // The shared PIN lock (commit 15) is shown and timed by pinLockSeconds, exactly as under the
  // profile switcher and on the Profiles page. It reads the capped lock end, so it never starts above
  // 5 min, and it ticks only while a lock lasts.
  const canSubmit = $derived(!!prompt && !prompt.busy && $pinLockSeconds === 0 && pin.length >= HOUSEHOLD_PIN_MIN)
  const dots = $derived(Array.from({ length: Math.max(HOUSEHOLD_PIN_MIN, pin.length) }, (_, index) => index))

  async function press(key: HouseholdKey) {
    if (!prompt || prompt.busy) return
    if (key !== 'ok') {
      pin = pinAfterKey(pin, key)
      return
    }
    if (!canSubmit) return
    const entered = pin
    if (!(await submitHouseholdPin(entered))) pin = ''
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    const top = topNavLayer()
    if (top && top.node() !== root) return
    let key: HouseholdKey | 'cancel' | null = null
    if (/^[0-9]$/.test(event.key)) key = event.key as HouseholdKey
    else if (event.key === 'Backspace' || event.key === 'Delete') key = 'clear'
    else if (event.key === 'Escape') key = 'cancel'
    else if (event.key === 'Enter') {
      // Enter on a focused keypad button presses that button (a TV remote's OK arrives as Enter).
      const active = document.activeElement
      if (active instanceof HTMLButtonElement && root?.contains(active)) return
      key = 'ok'
    }
    if (!key) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (key === 'cancel') cancelHouseholdPrompt()
    else void press(key)
  }

  onMount(() => {
    const active = document.activeElement
    const opener = active instanceof HTMLElement && active !== document.body ? active : null
    const openerDescriptor = describeFocus(opener)
    // Before pushNavLayer, so this Escape handler runs ahead of the layer stack's shared one.
    window.addEventListener('keydown', onKeydown, { capture: true })
    const removeLayer = pushNavLayer({
      kind: 'household-pin',
      node: () => root ?? null,
      restore: 'none',
      close: () => cancelHouseholdPrompt(),
    })
    void tick().then(() => root?.querySelector<HTMLElement>('[data-keypad-key="1"]')?.focus({ preventScroll: true }))
    return () => {
      window.removeEventListener('keydown', onKeydown, { capture: true })
      removeLayer()
      // Back to whatever asked for the PIN, unless something else has taken focus meanwhile.
      queueMicrotask(() => {
        const current = document.activeElement
        if (current && current !== document.body && current.isConnected) return
        if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true })
        else restoreFocus(openerDescriptor)
      })
    }
  })
</script>

{#if prompt}
  <div bind:this={root} role="dialog" aria-modal="true" aria-labelledby="household-pin-title" aria-describedby="household-pin-body"
       data-nav-trap data-nav-escape data-theme-protected
       class="fixed inset-0 z-[155] grid place-items-end bg-black/75 sm:place-items-center sm:p-4">
    <div class="w-full max-w-sm rounded-t-2xl border border-border bg-background p-5 shadow-2xl sm:rounded-2xl sm:p-6">
      <p class="flex items-center gap-2 text-xs font-bold text-muted-foreground"><LockKeyhole size={14} /> Main profile PIN</p>
      <h2 id="household-pin-title" class="mt-2 text-lg font-black">{HOUSEHOLD_ACTION_TITLES[prompt.action]}</h2>
      <p id="household-pin-body" class="mt-1 text-sm text-muted-foreground">Enter the main profile's PIN to continue.</p>
      <div class="mt-5 flex justify-center gap-3">
        {#each dots as index (index)}
          <span aria-hidden="true" class="size-3 rounded-full {index < pin.length ? 'bg-foreground' : 'border border-muted-foreground/60'}"></span>
        {/each}
        <span class="sr-only">{pin.length} digits entered</span>
      </div>
      {#if $pinLockSeconds > 0}<p role="timer" data-pin-countdown class="mt-3 min-h-5 text-center text-sm text-muted-foreground">{pinThrottleMessage($pinLockSeconds)}</p>
      {:else}<p role="status" aria-live="polite" class="mt-3 min-h-5 text-center text-sm {prompt.busy ? 'text-muted-foreground' : 'text-destructive'}">{prompt.busy ? 'Checking…' : prompt.error}</p>{/if}
      <div class="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="PIN keypad">
        {#each HOUSEHOLD_KEYPAD as key (key)}
          <button type="button" data-focusable data-keypad-key={key}
                  aria-label={key === 'clear' ? 'Delete last digit' : key === 'ok' ? 'Confirm PIN' : undefined}
                  aria-disabled={prompt.busy || (key === 'ok' && !canSubmit) ? 'true' : undefined}
                  onclick={() => void press(key)}
                  class="grid min-h-14 min-w-14 place-items-center rounded-xl text-xl font-bold transition-colors aria-disabled:opacity-40 {key === 'ok' ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent'}">
            {#if key === 'clear'}<Delete size={22} />{:else if key === 'ok'}OK{:else}{key}{/if}
          </button>
        {/each}
      </div>
      <button type="button" data-focusable onclick={() => cancelHouseholdPrompt()}
              class="mt-3 min-h-12 w-full rounded-xl text-sm font-bold text-muted-foreground hover:bg-secondary">Cancel</button>
      <p class="mt-3 text-center text-xs text-muted-foreground">Forgot the main PIN? The only way back is clearing izumi's app data in your system settings, which deletes everything on this device.</p>
    </div>
  </div>
{/if}
