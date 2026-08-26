<script lang="ts">
  import { onMount } from 'svelte'
  import {
    extensionServiceSettings,
    saveExtensionServiceSettings,
    type ServiceSettingField,
    type ServiceSettingValue,
    type ServiceSettingsDocument,
  } from '$lib/extensions/manager'
  import X from '@lucide/svelte/icons/x'
  import Check from '@lucide/svelte/icons/check'

  let { id, name, onclose }: { id: string; name: string; onclose: () => void } = $props()
  let document = $state<ServiceSettingsDocument | null>(null)
  let values = $state<Record<string, ServiceSettingValue>>({})
  let loading = $state(true)
  let saving = $state(false)
  let error = $state('')
  let message = $state('')
  let dialog = $state<HTMLElement>()

  function errorText(value: unknown) {
    return value instanceof Error ? value.message : String(value)
  }

  async function load() {
    loading = true
    error = ''
    try {
      document = await extensionServiceSettings(id)
      values = { ...document.values }
    } catch (cause) { error = errorText(cause) }
    finally { loading = false }
  }

  function setValue(key: string, value: ServiceSettingValue) {
    values[key] = value
  }

  function validField(field: ServiceSettingField): boolean {
    const value = values[field.key]
    return !field.required || !(value == null || (typeof value === 'string' && !value.trim()))
  }

  async function save() {
    if (!document || saving) return
    const missing = document.fields.find((field) => !validField(field))
    if (missing) { error = `${missing.label} is required.`; return }
    saving = true
    error = ''
    message = ''
    try {
      const result = await saveExtensionServiceSettings(id, { ...values })
      if (result.ok === false) throw new Error(result.message || 'The local service rejected these settings.')
      if (result.version === 1 && result.fields && result.values) {
        document = { ...document, ...result, version: 1, fields: result.fields, values: result.values }
        values = { ...result.values }
      }
      message = result.message || (result.restartRequired
        ? 'Saved. The service will apply this after it restarts.'
        : 'Settings saved.')
    } catch (cause) { error = errorText(cause) }
    finally { saving = false }
  }

  onMount(() => {
    const previousFocus = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null
    void load().then(() => requestAnimationFrame(() => dialog?.querySelector<HTMLElement>('[data-focusable]')?.focus()))
    return () => { if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus()) }
  })
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<div
  bind:this={dialog}
  role="dialog"
  aria-modal="true"
  aria-label="{name} settings"
  tabindex="-1"
  data-nav-trap
  class="fixed inset-0 z-[70] grid h-[100dvh] place-items-end overflow-hidden bg-black/70 sm:place-items-center sm:p-4"
  onclick={(event) => { if (event.target === event.currentTarget) onclose() }}
  onkeydown={(event) => { if (event.key === 'Escape') onclose() }}
>
  <div class="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
    <header class="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div class="min-w-0">
        <h3 class="truncate text-lg font-black">{document?.title || `${name} settings`}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">Local service · managed inside Izumi</p>
      </div>
      <button data-focusable aria-label="Close" onclick={onclose} class="grid size-8 shrink-0 place-items-center rounded-md hover:bg-accent"><X size={18} /></button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
      {#if loading}
        <div class="space-y-3" aria-label="Loading settings">
          <div class="skeloader h-4 w-2/3 rounded"></div>
          <div class="skeloader h-10 rounded-lg"></div>
          <div class="skeloader h-10 rounded-lg"></div>
        </div>
      {:else if document}
        {#if document.description}<p class="mb-4 text-sm text-muted-foreground">{document.description}</p>{/if}
        <div class="space-y-4">
          {#each document.fields as field (field.key)}
            <label class="block">
              <span class="mb-1 flex items-center gap-1 text-sm font-bold">
                {field.label}{#if field.required}<span class="text-destructive" aria-hidden="true">*</span>{/if}
              </span>
              {#if field.type === 'boolean'}
                <button
                  type="button"
                  data-focusable
                  data-switch
                  role="switch"
                  aria-checked={!!values[field.key]}
                  onclick={() => setValue(field.key, !values[field.key])}
                  class="flex w-full items-center justify-between rounded-lg bg-input px-3 py-2.5 text-left text-sm"
                >
                  <span>{values[field.key] ? 'On' : 'Off'}</span>
                  <span class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors {!!values[field.key] ? 'bg-theme' : 'bg-white/20 ring-1 ring-inset ring-white/20'}">
                    <span class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform {!!values[field.key] ? 'translate-x-4' : 'translate-x-0.5'}"></span>
                  </span>
                </button>
              {:else if field.type === 'select'}
                <select
                  data-focusable
                  value={String(values[field.key] ?? '')}
                  onchange={(event) => setValue(field.key, event.currentTarget.value)}
                  class="w-full rounded-lg bg-input px-3 py-2.5 text-sm"
                >
                  {#each field.options ?? [] as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              {:else if field.type === 'number'}
                <input
                  data-focusable
                  type="number"
                  value={values[field.key] == null ? '' : Number(values[field.key])}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  placeholder={field.placeholder}
                  required={field.required}
                  oninput={(event) => setValue(field.key, event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber)}
                  class="w-full rounded-lg bg-input px-3 py-2.5 text-sm"
                />
              {:else}
                <input
                  data-focusable
                  type={field.type === 'password' ? 'password' : 'text'}
                  value={String(values[field.key] ?? '')}
                  placeholder={field.placeholder}
                  required={field.required}
                  autocomplete={field.type === 'password' ? 'off' : undefined}
                  oninput={(event) => setValue(field.key, event.currentTarget.value)}
                  class="w-full rounded-lg bg-input px-3 py-2.5 text-sm"
                />
              {/if}
              {#if field.description}<span class="mt-1 block text-xs text-muted-foreground">{field.description}</span>{/if}
            </label>
          {/each}
        </div>
      {/if}

      {#if error}
        <div role="alert" class="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
          {#if !document}<button data-focusable onclick={load} class="ml-2 font-bold underline">Retry</button>{/if}
        </div>
      {/if}
      {#if message}<p role="status" class="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{message}</p>{/if}
    </div>

    <footer class="flex shrink-0 justify-end gap-2 border-t border-border bg-card px-5 pt-3" style="padding-bottom: max(1rem, env(safe-area-inset-bottom));">
      <button data-focusable onclick={onclose} class="rounded-md bg-secondary px-4 py-2 text-sm font-bold">Close</button>
      {#if document}
        <button data-focusable onclick={save} disabled={saving} class="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
          <Check size={16} /> {saving ? 'Saving…' : 'Save settings'}
        </button>
      {/if}
    </footer>
  </div>
</div>
