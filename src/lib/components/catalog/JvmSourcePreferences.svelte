<script lang="ts">
  import { onMount } from 'svelte'
  import X from '@lucide/svelte/icons/x'
  import Check from '@lucide/svelte/icons/check'
  import {
    applyJvmSourcePreferenceChanges,
    jvmCatalogSourcePreferences,
    saveJvmCatalogSourcePreference,
    type JvmSourcePreference,
  } from '$lib/extensions/manager'

  let { sourceId, sourceName, onClose }: { sourceId: string; sourceName: string; onClose: () => void } = $props()
  let preferences = $state<JvmSourcePreference[]>([])
  let initial = $state<Record<string, unknown>>({})
  let loading = $state(true)
  let saving = $state(false)
  let error = $state('')
  let saved = $state<'' | 'applied' | 'after-playback'>('')

  const isToggle = (preference: JvmSourcePreference) =>
    preference.type === 'switch' || preference.type === 'checkbox' || preference.type === 'checkBox'
  // The desktop runtime does not report a choice the user never saved; the source then uses its
  // own default, which this dialog cannot see. Say so rather than showing the first option.
  const unreported = (preference: JvmSourcePreference) =>
    preference.value === undefined || preference.value === null || preference.value === ''

  function copyValue(value: unknown): unknown {
    return value != null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
  }

  function setValue(index: number, value: unknown) {
    preferences = preferences.map((preference, current) => current === index ? { ...preference, value } : preference)
    saved = ''
  }

  function toggleMulti(index: number, value: string) {
    const selected = Array.isArray(preferences[index].value) ? preferences[index].value as string[] : []
    setValue(index, selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])
  }

  async function load() {
    loading = true
    error = ''
    try {
      preferences = await jvmCatalogSourcePreferences(sourceId)
      initial = Object.fromEntries(preferences.map((preference) => [preference.key, copyValue(preference.value)]))
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }

  async function save() {
    if (saving) return
    saving = true
    error = ''
    saved = ''
    try {
      const changed = preferences.filter((preference) =>
        preference.key && JSON.stringify(preference.value) !== JSON.stringify(initial[preference.key]))
      for (const preference of changed) {
        const ok = await saveJvmCatalogSourcePreference(sourceId, preference.key, preference.value)
        if (!ok) throw new Error(`${preference.title || preference.key} could not be saved.`)
      }
      initial = Object.fromEntries(preferences.map((preference) => [preference.key, copyValue(preference.value)]))
      if (changed.length) {
        const outcome = await applyJvmSourcePreferenceChanges()
        // A restarted runtime forgets which screen it built; read it again so further saves reach
        // the source's own change handlers and summaries show the new choices.
        if (outcome === 'applied') await load()
        saved = outcome
      } else {
        saved = 'applied'
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      saving = false
    }
  }

  onMount(() => void load())
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') onClose() }} />

<div role="dialog" aria-modal="true" aria-label="{sourceName} settings" tabindex="-1" class="fixed inset-0 z-[150] grid place-items-end bg-black/70 sm:place-items-center sm:p-4" onclick={(event) => { if (event.target === event.currentTarget) onClose() }} onkeydown={(event) => { if (event.key === 'Escape') onClose() }}>
  <section class="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
    <header class="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div>
        <h2 class="text-lg font-black">{sourceName}</h2>
        <p class="text-xs text-muted-foreground">Settings provided by the Aniyomi source</p>
      </div>
      <button type="button" data-focusable onclick={onClose} aria-label="Close settings" class="grid size-9 place-items-center rounded-full hover:bg-accent"><X size={18} /></button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {#if loading}
        <div class="space-y-3"><div class="skeloader h-12 rounded-lg"></div><div class="skeloader h-12 rounded-lg"></div></div>
      {:else if !preferences.length && !error}
        <p class="rounded-xl bg-secondary/50 p-5 text-sm text-muted-foreground">This source does not expose configurable preferences.</p>
      {:else}
        <div class="space-y-4">
          {#each preferences as preference, index (preference.key || `${index}:${preference.title}`)}
            {#if preference.type === 'other'}
              {#if preference.title}<h3 class="border-b border-border/60 pb-2 pt-2 text-sm font-black">{preference.title}</h3>{/if}
            {:else}
              <label class="block text-sm font-bold" class:opacity-50={preference.enabled === false}>
                <span class="mb-1.5 block">{preference.title || preference.key}</span>
                {#if isToggle(preference)}
                  <button type="button" data-focusable disabled={preference.enabled === false} onclick={() => setValue(index, preference.value !== true)} class="flex min-h-11 w-full items-center justify-between rounded-lg bg-input px-3 text-left">
                    <span>{preference.value === true ? 'On' : 'Off'}</span>
                    <span class="relative inline-flex h-5 w-9 items-center rounded-full {preference.value === true ? 'bg-theme' : 'bg-white/20'}"><span class="size-4 rounded-full bg-white transition-transform {preference.value === true ? 'translate-x-[18px]' : 'translate-x-0.5'}"></span></span>
                  </button>
                {:else if preference.type === 'list'}
                  <select data-focusable disabled={preference.enabled === false} value={String(preference.value ?? '')} onchange={(event) => setValue(index, event.currentTarget.value)} class="h-11 w-full rounded-lg bg-input px-3 text-base">
                    {#if unreported(preference)}<option value="" disabled>Source default</option>{/if}
                    {#each preference.entryValues ?? [] as value, optionIndex}<option {value}>{preference.entries?.[optionIndex] ?? value}</option>{/each}
                  </select>
                {:else if preference.type === 'multi_select'}
                  <div class="rounded-lg bg-input p-2">
                    {#if unreported(preference)}<p class="px-2 pb-1 text-xs font-normal text-muted-foreground">Source default until you choose</p>{/if}
                    {#each preference.entryValues ?? [] as value, optionIndex}
                      <button type="button" data-focusable disabled={preference.enabled === false} onclick={() => toggleMulti(index, value)} class="flex min-h-10 w-full items-center justify-between rounded-md px-2 text-left hover:bg-accent">
                        <span>{preference.entries?.[optionIndex] ?? value}</span>
                        {#if Array.isArray(preference.value) && preference.value.includes(value)}<Check size={17} class="text-theme" />{/if}
                      </button>
                    {/each}
                  </div>
                {:else}
                  <input data-focusable disabled={preference.enabled === false} value={String(preference.value ?? '')} placeholder={unreported(preference) ? 'Source default' : undefined} oninput={(event) => setValue(index, event.currentTarget.value)} class="h-11 w-full rounded-lg bg-input px-3 text-base" />
                {/if}
                {#if preference.summary}<span class="mt-1.5 block text-xs font-normal text-muted-foreground">{preference.summary}</span>{/if}
              </label>
            {/if}
          {/each}
        </div>
      {/if}
      {#if error}<p class="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>{/if}
    </div>

    {#if preferences.length}
      <footer class="flex min-h-16 items-center justify-end gap-3 border-t border-border px-5 py-3">
        {#if saved === 'applied'}<span class="text-xs font-bold text-emerald-400">Saved</span>{/if}
        {#if saved === 'after-playback'}<span class="text-xs font-bold text-emerald-400">Saved · some changes finish applying after playback</span>{/if}
        <button type="button" data-focusable disabled={saving} onclick={() => void save()} class="min-h-10 rounded-lg bg-primary px-5 text-sm font-black text-primary-foreground disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
      </footer>
    {/if}
  </section>
</div>
