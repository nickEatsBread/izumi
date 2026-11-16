<script lang="ts">
  import { onMount } from 'svelte'
  import {
    extensionServiceSettings,
    saveExtensionServiceSettings,
    type ServiceSettingField,
    type ServiceSettingValue,
    type ServiceSettingsDocument,
  } from '$lib/extensions/manager'
  import {
    matchesServiceSettingCondition,
    serviceSubmitPresentation,
    visibleServiceSettingFields,
  } from '$lib/extensions/service-settings-form'
  import { copyToClipboard } from '$lib/util/clipboard'
  import QrCode from '$lib/components/QrCode.svelte'
  import { navLayer } from '$lib/nav/overlay'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import X from '@lucide/svelte/icons/x'
  import Check from '@lucide/svelte/icons/check'
  import Copy from '@lucide/svelte/icons/copy'
  import ExternalLink from '@lucide/svelte/icons/external-link'

  let {
    id,
    name,
    onclose = () => {},
    inline = false,
    oncomplete,
  }: {
    id: string
    name: string
    onclose?: () => void
    /** Render in the page (a pack's setup step) instead of as a dialog. */
    inline?: boolean
    /** Follows the service's `complete` flag. */
    oncomplete?: (complete: boolean) => void
  } = $props()
  let document = $state<ServiceSettingsDocument | null>(null)
  let values = $state<Record<string, ServiceSettingValue>>({})
  let loading = $state(true)
  let saving = $state(false)
  let error = $state('')
  let message = $state('')
  let codeCopied = $state(false)
  let dialog = $state<HTMLElement>()
  let root = $state<HTMLElement>()
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let destroyed = false
  const dirtyKeys = new Set<string>()

  const visibleFields = $derived(document ? visibleServiceSettingFields(document, values) : [])
  const submit = $derived(document ? serviceSubmitPresentation(document, values) : null)
  const notice = $derived(
    document?.notice && matchesServiceSettingCondition(document.notice.visibleWhen, values)
      ? document.notice
      : null,
  )

  $effect(() => {
    oncomplete?.(document?.complete === true)
  })

  function errorText(value: unknown) {
    return value instanceof Error ? value.message : String(value)
  }

  function applyDocument(next: ServiceSettingsDocument, preserveDirty = false) {
    const nextValues = { ...next.values }
    if (preserveDirty) {
      for (const key of dirtyKeys) {
        if (key in values) nextValues[key] = values[key]
      }
    }
    document = next
    values = nextValues
  }

  function schedulePoll(delay = document?.refreshAfterMs) {
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = undefined
    if (destroyed || !delay || !Number.isFinite(delay) || delay <= 0) return
    const safeDelay = Math.max(750, Math.min(10_000, delay))
    pollTimer = setTimeout(() => void poll(), safeDelay)
  }

  async function poll() {
    if (destroyed) return
    try {
      applyDocument(await extensionServiceSettings(id), true)
    } catch {
      // A transient service restart should not throw away a form the user is editing.
    } finally {
      schedulePoll()
    }
  }

  async function load() {
    loading = true
    error = ''
    try {
      applyDocument(await extensionServiceSettings(id))
      dirtyKeys.clear()
      schedulePoll()
    } catch (cause) { error = errorText(cause) }
    finally { loading = false }
  }

  function setValue(key: string, value: ServiceSettingValue) {
    values[key] = value
    dirtyKeys.add(key)
    error = ''
    message = ''
    codeCopied = false
  }

  function validField(field: ServiceSettingField): boolean {
    const value = values[field.key]
    return !field.required || !(value == null || (typeof value === 'string' && !value.trim()))
  }

  async function save() {
    if (!document || saving) return
    const missing = visibleFields.find((field) => !validField(field))
    if (missing) { error = `${missing.label} is required.`; return }
    saving = true
    error = ''
    message = ''
    try {
      const result = await saveExtensionServiceSettings(id, { ...values })
      if (result.ok === false) throw new Error(result.message || 'The local service rejected these settings.')
      if (result.version === 1 && result.fields && result.values) {
        // A full result's picture is its own: a signed-out one has none to inherit.
        applyDocument({ ...document, image: undefined, ...result, version: 1, fields: result.fields, values: result.values })
        dirtyKeys.clear()
        schedulePoll()
      }
      message = result.message || (result.restartRequired
        ? 'Saved. The service will apply this after it restarts.'
        : 'Settings saved.')
    } catch (cause) { error = errorText(cause) }
    finally { saving = false }
  }

  function copyCode(code: string) {
    codeCopied = copyToClipboard(code)
    if (!codeCopied) error = 'The code could not be copied. You can still enter it manually.'
  }

  async function openNoticeAction(url: string) {
    if (!/^https:\/\//i.test(url)) {
      error = 'This service returned an invalid sign-in link.'
      return
    }
    try { await openUrl(url) }
    catch (cause) { error = errorText(cause) }
  }

  function noticeClass(tone: 'info' | 'success' | 'warning' | 'error') {
    if (tone === 'success') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
    if (tone === 'warning') return 'border-amber-500/30 bg-amber-500/10 text-amber-100'
    if (tone === 'error') return 'border-destructive/30 bg-destructive/10 text-destructive'
    return 'border-sky-500/30 bg-sky-500/10 text-sky-100'
  }

  onMount(() => {
    const previousFocus = globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null
    void load().then(() => requestAnimationFrame(() => (inline ? root : dialog)?.querySelector<HTMLElement>('[data-focusable]')?.focus()))
    return () => {
      destroyed = true
      if (pollTimer) clearTimeout(pollTimer)
      if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus())
    }
  })
</script>

{#snippet formBody()}
  {#if loading}
    <div class="space-y-3" aria-label="Loading settings">
      <div class="skeloader h-4 w-2/3 rounded"></div>
      <div class="skeloader h-10 rounded-lg"></div>
      <div class="skeloader h-10 rounded-lg"></div>
    </div>
  {:else if document}
    {#if document.description}
      <p class="mb-4 flex items-center gap-3 text-sm text-muted-foreground">
        {#if document.image}<img src={document.image} alt="" class="size-12 shrink-0 rounded-lg object-cover" />{/if}
        {document.description}
      </p>
    {/if}
    {#if notice}
      <section class="mb-4 rounded-xl border p-4 {noticeClass(notice.tone)}" aria-live="polite">
        {#if notice.title}<h4 class="font-black">{notice.title}</h4>{/if}
        <p class:mt-1={!!notice.title} class="text-sm opacity-90">{notice.message}</p>
        {#if notice.code}
          <div class="mt-3 flex items-center gap-2">
            <code class="min-w-0 flex-1 select-all rounded-lg bg-black/25 px-3 py-2 text-center text-xl font-black tracking-[0.2em] text-foreground">{notice.code}</code>
            <button
              data-focusable
              type="button"
              aria-label="Copy code"
              onclick={() => copyCode(notice.code!)}
              class="flex shrink-0 items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground"
            ><Copy size={16} /> {codeCopied ? 'Copied' : 'Copy'}</button>
          </div>
          <!-- A code with its sign-in page: a phone can scan the page instead of typing an address on a
               Steam Deck or TV, as the source's own handheld app offers. -->
          {#if notice.action && /^https:\/\//.test(notice.action.url)}
            <figure data-part="settings.signin.qr" class="mt-3 flex items-center gap-4">
              <div class="w-36 shrink-0"><QrCode value={notice.action.url} label="Sign-in page" /></div>
              <figcaption class="text-sm opacity-90">Scan with your phone to open the sign-in page, then enter the code.</figcaption>
            </figure>
          {/if}
        {/if}
        {#if notice.action}
          <button
            data-focusable
            type="button"
            onclick={() => openNoticeAction(notice.action!.url)}
            class="mt-3 flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm font-bold text-secondary-foreground"
          ><ExternalLink size={16} /> {notice.action.label}</button>
        {/if}
      </section>
    {/if}
    <div class="space-y-4">
      {#each visibleFields as field (field.key)}
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
          {:else if field.type === 'select' && (field.role === 'action' || (field.options?.length ?? 0) <= 6 || field.options?.some((option) => option.image || option.backdrop))}
            <!-- Short lists (and pictured ones) are buttons, not a native select: select popups are unreliable with a controller. -->
            <span role="radiogroup" aria-label={field.label} class="flex flex-col gap-2">
              {#each field.options ?? [] as option (option.value)}
                <button
                  type="button"
                  data-focusable
                  role="radio"
                  aria-checked={values[field.key] === option.value}
                  onclick={() => setValue(field.key, option.value)}
                  class="relative flex items-center gap-3 overflow-hidden rounded-lg border px-3 py-2.5 text-left text-sm {values[field.key] === option.value ? 'border-theme bg-theme/15' : 'border-border bg-input'}"
                >
                  {#if option.backdrop}<img src={option.backdrop} alt="" class="pointer-events-none absolute inset-0 size-full object-cover opacity-30" />{/if}
                  {#if option.image}<img src={option.image} alt="" class="relative size-10 shrink-0 rounded-md object-cover" />{/if}
                  <span class="relative min-w-0 flex-1">
                    <span class="block font-bold">{option.label}</span>
                    {#if option.description}<span class="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>{/if}
                  </span>
                </button>
              {/each}
            </span>
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
          {#if field.role === 'action' && field.type !== 'select' && submit?.description}
            <span class="mt-1 block text-xs text-muted-foreground">{submit.description}</span>
          {/if}
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
{/snippet}

{#snippet submitButton()}
  {#if document && submit && !submit.hidden}
    <button
      data-focusable
      onclick={save}
      disabled={saving}
      class="flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-bold disabled:opacity-50 {submit.intent === 'danger' ? 'bg-destructive text-white' : 'bg-primary text-primary-foreground'}"
    >
      <Check size={16} /> {saving ? submit.submittingLabel : submit.label}
    </button>
  {/if}
{/snippet}

{#if inline}
  <div bind:this={root} class="space-y-4" data-service-settings-inline>
    {@render formBody()}
    <div class="flex justify-end">{@render submitButton()}</div>
  </div>
{:else}
<!-- A nav layer: Escape (the shared capture), B and remote Back close it, except while a save is in
     flight. It moves focus in once the settings load and restores it on close itself (onMount).
     The backdrop click is a pointer shortcut; keys close it through the layer. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={dialog}
  role="dialog"
  aria-modal="true"
  aria-label="{name} settings"
  tabindex="-1"
  data-nav-trap
  data-nav-escape
  use:navLayer={{ kind: 'extension-service-settings', onClose: () => { if (saving) return false; onclose() }, initialFocus: 'none', returnFocus: 'none' }}
  class="fixed inset-0 z-[70] grid h-[100dvh] place-items-end overflow-hidden bg-black/70 sm:place-items-center sm:p-4"
  onclick={(event) => { if (event.target === event.currentTarget) onclose() }}
>
  <div class="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
    <header class="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div class="min-w-0">
        <h3 class="truncate text-lg font-black">{document?.title || `${name} settings`}</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">Local service · managed inside Izumi</p>
      </div>
      <button data-focusable aria-label="Close" onclick={onclose} class="grid size-8 shrink-0 place-items-center rounded-md hover:bg-accent"><X size={18} /></button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4" data-nav-scroll-container>
      {@render formBody()}
    </div>

    <footer class="flex shrink-0 justify-end gap-2 border-t border-border bg-card px-5 pt-3" style="padding-bottom: max(1rem, env(safe-area-inset-bottom));">
      <button data-focusable onclick={onclose} class="rounded-md bg-secondary px-4 py-2 text-sm font-bold">Close</button>
      {@render submitButton()}
    </footer>
  </div>
</div>
{/if}
