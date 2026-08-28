<script lang="ts">
  import { onDestroy } from 'svelte'
  import Check from '@lucide/svelte/icons/check'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'

  type RefreshPhase = 'idle' | 'refreshing' | 'success' | 'error'

  let {
    onRefresh,
    label = 'Refresh',
    busyLabel = 'Refreshing…',
    successLabel = 'Refreshed',
    errorLabel = 'Refresh failed',
    iconOnly = false,
    disabled = false,
    class: className = '',
  }: {
    onRefresh: () => void | boolean | Promise<void | boolean>
    label?: string
    busyLabel?: string
    successLabel?: string
    errorLabel?: string
    iconOnly?: boolean
    disabled?: boolean
    class?: string
  } = $props()

  let phase = $state<RefreshPhase>('idle')
  let resetTimer: ReturnType<typeof setTimeout> | undefined

  const stateLabel = $derived(
    phase === 'refreshing' ? busyLabel
    : phase === 'success' ? successLabel
    : phase === 'error' ? errorLabel
    : label,
  )

  function settle(next: 'success' | 'error') {
    phase = next
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => (phase = 'idle'), next === 'success' ? 1800 : 2600)
  }

  async function run() {
    if (disabled || phase === 'refreshing') return
    clearTimeout(resetTimer)
    phase = 'refreshing'
    try {
      settle(await onRefresh() === false ? 'error' : 'success')
    } catch {
      // A view can present more detail beside the data. The control still acknowledges the failed
      // click instead of silently snapping back to idle when the callback throws unexpectedly.
      settle('error')
    }
  }

  onDestroy(() => clearTimeout(resetTimer))
</script>

<span class="contents">
  <button
    type="button"
    data-focusable
    onclick={run}
    disabled={disabled || phase === 'refreshing'}
    aria-label={iconOnly ? stateLabel : undefined}
    aria-busy={phase === 'refreshing'}
    title={iconOnly ? stateLabel : undefined}
    class="{iconOnly ? 'grid place-items-center' : 'flex items-center justify-center gap-2'} transition-colors disabled:cursor-wait disabled:opacity-70 {className}"
  >
    {#if phase === 'success'}
      <Check size={15} class="text-emerald-400" aria-hidden="true" />
    {:else if phase === 'error'}
      <CircleAlert size={15} class="text-destructive" aria-hidden="true" />
    {:else}
      <RefreshCw size={15} class={phase === 'refreshing' ? 'animate-spin' : ''} aria-hidden="true" />
    {/if}
    {#if !iconOnly}<span>{stateLabel}</span>{/if}
  </button>
  <span class="sr-only" role="status" aria-live="polite">
    {phase === 'success' || phase === 'error' ? stateLabel : ''}
  </span>
</span>
