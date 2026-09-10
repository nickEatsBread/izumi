<script lang="ts">
  import type { Snippet } from 'svelte'
  import Check from '@lucide/svelte/icons/check'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import { m } from '$lib/paraglide/messages.js'
  import { tileBusy, type ConnectState } from '$lib/onboarding/connect-state'

  let {
    name,
    logo,
    initial,
    description,
    // Bound under a different name than the `state` prop: a local binding called `state` would make
    // the compiler read `$state(...)` below as a store subscription instead of the rune.
    state: connection,
    expanded = false,
    onexpand,
    panel,
  }: {
    name: string
    logo: string
    initial: string
    description: string
    state: ConnectState
    expanded?: boolean
    onexpand: () => void
    panel?: Snippet
  } = $props()

  let logoBroken = $state(false)
  const busy = $derived(tileBusy(connection))
</script>

<div class="setup-choice p-4 {expanded ? 'selected' : ''}">
  <div class="flex items-center gap-3">
    {#if logoBroken}
      <span aria-hidden="true" class="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-bold">{initial}</span>
    {:else}
      <img src={logo} alt="" aria-hidden="true" class="size-9 shrink-0 rounded-lg object-contain" onerror={() => logoBroken = true} />
    {/if}
    <div class="min-w-0 flex-1">
      <p class="text-sm font-semibold">{name}</p>
      <p class="mt-0.5 truncate text-xs text-muted-foreground">
        {#if connection.status === 'connected'}{connection.identity || description}
        {:else if connection.status === 'busy'}{m.onboarding_connect_working()}
        {:else}{description}{/if}
      </p>
    </div>
    {#if connection.status === 'connected'}
      <span class="flex shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs font-semibold"><Check size={13} />{m.onboarding_connect_connected()}</span>
    {:else}
      <button type="button" data-focusable onclick={onexpand} disabled={busy} class="setup-inline-button shrink-0 bg-secondary px-3 text-sm">
        {#if busy}<LoaderCircle size={15} class="tile-spinner" />{/if}
        {expanded ? m.onboarding_connect_close() : m.onboarding_connect_action()}
      </button>
    {/if}
  </div>
  {#if expanded && connection.status !== 'connected' && panel}
    <div class="mt-4 border-t border-border pt-4">{@render panel()}</div>
  {/if}
  {#if connection.status === 'error'}<p role="alert" class="mt-3 text-sm leading-relaxed text-destructive">{connection.message}</p>{/if}
</div>
