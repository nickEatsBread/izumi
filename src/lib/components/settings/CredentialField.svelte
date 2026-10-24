<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import Eye from '@lucide/svelte/icons/eye'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import { isTv } from '$lib/platform'
  import { settingsControllerMode } from '$lib/settings/surface'
  // Controller mode (spec §5.4): typing a key on a remote is slow, so the row also offers the device
  // transfer in Devices and backup, which brings keys over from a phone or a computer.
  const SEND_FROM_PHONE_HREF = '/app/settings/devices'
  let { value = $bindable(''), label, description = 'Stored on this device.', placeholder = 'Paste your key', help, startOpen = false }: {
    value: string; label: string; description?: string; placeholder?: string; help?: Snippet; startOpen?: boolean
  } = $props()
  let editing = $state(false)
  let draft = $state('')
  let revealed = $state(false)
  let confirmRemove = $state(false)
  let notice = $state('')
  onMount(() => { if (startOpen && !value) edit() })
  function edit() { draft = value; revealed = false; confirmRemove = false; notice = ''; editing = true }
  function cancel() { draft = ''; revealed = false; confirmRemove = false; editing = false }
  function save(event: SubmitEvent) {
    event.preventDefault()
    if (!draft.trim()) return
    value = draft.trim(); cancel(); notice = 'Saved on this device. Not yet verified with the service.'
  }
  function remove() {
    if (!confirmRemove) { confirmRemove = true; return }
    value = ''; cancel(); notice = 'Credential removed from this device.'
  }
</script>

<div class="credential-field" data-credential-field={label}>
  <div class="flex min-h-11 items-center justify-between gap-4">
    <div class="min-w-0"><p class="text-sm font-semibold">{label}</p><p class="mt-1 text-xs text-muted-foreground">{value ? 'Credential saved · hidden' : 'Not configured'}</p></div>
    {#if !editing}
      <div class="flex shrink-0 items-center gap-2">
        <button type="button" data-focusable onclick={edit} class="min-h-10 shrink-0 rounded-lg bg-secondary px-3 text-xs font-semibold transition-colors hover:bg-accent">{$settingsControllerMode ? ($isTv ? 'Enter on this TV' : 'Enter on this device') : value ? 'Edit' : 'Set up'}</button>
        {#if $settingsControllerMode}<a href={SEND_FROM_PHONE_HREF} data-focusable class="flex min-h-10 shrink-0 items-center rounded-lg px-3 text-xs font-semibold transition-colors hover:bg-secondary">Send from phone</a>{/if}
      </div>
    {/if}
  </div>
  {#if editing}
    <form onsubmit={save} class="mt-3 space-y-3 border-t border-border pt-4">
      <p class="max-w-prose text-xs leading-5 text-muted-foreground">{description}</p>
      {#if help}<div class="text-xs">{@render help()}</div>{/if}
      <label class="relative block"><span class="sr-only">{label}</span>
        <input bind:value={draft} type={revealed ? 'text' : 'password'} {placeholder} data-focusable autocomplete="off" spellcheck="false" class="h-11 w-full rounded-lg bg-input pl-3 pr-12 font-mono text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground" />
        <button type="button" data-focusable onclick={() => revealed = !revealed} aria-label={`${revealed ? 'Hide' : 'Show'} ${label}`} class="absolute right-1 top-1 grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground">{#if revealed}<EyeOff size={16} />{:else}<Eye size={16} />{/if}</button>
      </label>
      {#if confirmRemove}<p role="alert" class="text-xs text-destructive">Remove this credential? This service will need to be set up again.</p>{/if}
      <div class="flex flex-wrap items-center gap-2">
        <button type="submit" data-focusable disabled={!draft.trim()} class="min-h-10 rounded-lg bg-foreground px-4 text-xs font-semibold text-background disabled:opacity-40">Save</button>
        <button type="button" data-focusable onclick={cancel} class="min-h-10 rounded-lg px-3 text-xs font-semibold hover:bg-secondary">Cancel</button>
        {#if value}<button type="button" data-focusable onclick={remove} class="ml-auto min-h-10 rounded-lg px-3 text-xs text-destructive hover:bg-destructive/10">{confirmRemove ? 'Confirm remove' : 'Remove'}</button>{/if}
      </div>
    </form>
  {/if}
  {#if notice}<p role="status" class="mt-2 text-xs text-muted-foreground">{notice}</p>{/if}
</div>
