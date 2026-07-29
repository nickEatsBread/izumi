<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { onMount } from 'svelte'
  import ExternalLink from 'lucide-svelte/icons/external-link'
  import RefreshCw from 'lucide-svelte/icons/refresh-cw'
  import { fetchManifest, type AddonManifest } from '$lib/stremio/manifest'
  import { normalizeBase } from '$lib/stremio/sources'

  let {
    name,
    expectedId,
    configureUrl,
    onCancel,
    onConfigured,
  }: {
    name: string
    expectedId: string
    configureUrl: string
    onCancel: () => void
    onConfigured: (base: string, manifest: AddonManifest) => void
  } = $props()

  let input = $state('')
  let busy = $state(false)
  let error = $state('')
  let dialogEl = $state<HTMLElement>()

  $effect(() => { dialogEl?.focus() })
  onMount(() => { void openConfiguration() })

  async function openConfiguration() {
    error = ''
    try {
      await openUrl(configureUrl)
    } catch (cause) {
      error = `Could not open the configuration page: ${cause instanceof Error ? cause.message : String(cause)}`
    }
  }

  async function install() {
    const base = normalizeBase(input)
    if (!base) {
      error = 'Paste the Stremio install link or configured manifest URL.'
      return
    }
    busy = true
    error = ''
    try {
      const manifest = await fetchManifest(base)
      if (!manifest?.id || !manifest.name) {
        throw new Error('That address did not return a valid Stremio manifest.')
      }
      if (manifest.id !== expectedId) {
        throw new Error(`That link belongs to ${manifest.name}, not ${name}.`)
      }
      onConfigured(base, manifest)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && !busy) onCancel() }} />

<div
  class="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4"
  role="presentation"
  onclick={(event) => { if (event.target === event.currentTarget && !busy) onCancel() }}
>
  <div
    bind:this={dialogEl}
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-labelledby="addon-configurator-title"
    data-nav-trap
    class="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-2xl outline-none sm:p-6"
  >
    <h2 id="addon-configurator-title" class="text-lg font-black">Configure {name}</h2>
    <p class="mt-2 text-sm text-muted-foreground">
      Finish setup on the add-on's website. Then copy its <strong class="text-foreground">Install</strong>
      link (or configured <code class="rounded bg-secondary px-1 text-xs">manifest.json</code> URL) and paste it below.
    </p>

    <button
      type="button"
      data-focusable
      onclick={openConfiguration}
      class="mt-4 flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-bold hover:bg-accent"
    >
      Open configuration page <ExternalLink size={14} />
    </button>

    <label class="mt-4 block">
      <span class="text-sm font-bold">Configured manifest link</span>
      <input
        bind:value={input}
        data-focusable
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        placeholder="https://…/manifest.json"
        class="mt-1 w-full rounded-lg bg-input px-3 py-2.5 text-sm"
        onkeydown={(event) => { if (event.key === 'Enter' && !busy) void install() }}
      />
    </label>
    <p class="mt-2 text-xs text-amber-400">
      This link may contain API keys or debrid credentials. It stays in Izumi's local settings unless you explicitly sync or export settings with secrets.
    </p>

    {#if error}
      <p role="alert" class="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
    {/if}

    <div class="mt-5 flex justify-end gap-2">
      <button type="button" data-focusable disabled={busy} onclick={onCancel}
        class="rounded-lg bg-secondary px-4 py-2 text-sm font-bold disabled:opacity-50">Cancel</button>
      <button type="button" data-focusable disabled={busy || !input.trim()} onclick={install}
        class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-black text-primary-foreground disabled:opacity-50">
        {#if busy}<RefreshCw size={14} class="animate-spin" />{/if}
        Verify and install
      </button>
    </div>
  </div>
</div>
