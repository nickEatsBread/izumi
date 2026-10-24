<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import Check from '@lucide/svelte/icons/check'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import Store from '@lucide/svelte/icons/store'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import { m } from '$lib/paraglide/messages.js'
  import PlaybackChoice from './PlaybackChoice.svelte'
  import { addSourceSpec } from '$lib/settings/add-source'
  import { fetchManifest } from '$lib/stremio/manifest'
  import { addonUrls, CINEMETA_BASE, normalizeBase } from '$lib/stremio/sources'
  import { fetchExtensionInfo } from '$lib/extensions/manager'
  import { extensionUrls } from '$lib/settings/ui'

  let {
    synced = false,
    busy = $bindable(),
    onbrowse,
  }: { synced?: boolean; busy: boolean; onbrowse: () => void } = $props()

  let input = $state('')
  let adding = $state(false)
  let addError = $state('')
  let checkingKey = $state(false)
  let health = $state<'empty' | 'checking' | 'ready' | 'error'>('empty')
  let errorAlert = $state<HTMLElement>()
  const abort = new AbortController()

  // Cinemeta only supplies metadata, so it does not count as a source.
  const streamAddons = $derived($addonUrls.filter((url) => normalizeBase(url) !== normalizeBase(CINEMETA_BASE)))
  const sourceCount = $derived(streamAddons.length + $extensionUrls.length)
  const reviewFace = $derived(synced && sourceCount > 0)

  // Two things hold the footer here: a source still being added and a debrid key still being checked.
  $effect(() => {
    busy = adding || checkingKey
  })

  // The shell's busy flag is bound to this screen. If it unmounts mid-add or mid key check, nothing
  // else would ever clear it, leaving Back disabled on the next screen.
  onDestroy(() => {
    abort.abort()
    busy = false
  })
  onMount(() => {
    if (sourceCount) void check()
  })

  async function check() {
    const addons = [...streamAddons]
    const extensions = [...$extensionUrls]
    if (!addons.length && !extensions.length) {
      health = 'empty'
      return
    }
    health = 'checking'
    const checks = await Promise.all([
      ...addons.map(async (url) => Boolean(await fetchManifest(url).catch(() => null))),
      ...extensions.map(async (url) => {
        const info = await fetchExtensionInfo(url).catch(() => null)
        return Boolean(info && (info.configs.length > 0 || info.packages?.length))
      }),
    ])
    if (abort.signal.aborted) return
    health = checks.some(Boolean) ? 'ready' : 'error'
  }

  /** Adds whatever the user pasted, through the same path as Settings → Sources. Nothing is ever
   *  added for them, so izumi never ends up with a source the user did not choose. */
  async function add(): Promise<boolean> {
    if (adding || !input.trim()) return !input.trim()
    adding = true
    addError = ''
    try {
      const result = await addSourceSpec(input)
      if (abort.signal.aborted) return false
      if ('error' in result) {
        addError = result.error
        // Next disables itself while adding, which drops focus out of the dialog.
        await tick()
        errorAlert?.focus()
        return false
      }
      input = ''
      void check()
      return true
    } finally {
      if (!abort.signal.aborted) adding = false
    }
  }

  /** The shell's Next calls this: a URL pasted but not yet added is added rather than dropped.
   *  True means the flow may move on. */
  export async function install(): Promise<boolean> {
    return add()
  }
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{reviewFace ? m.onboarding_sources_review_title() : m.onboarding_sources_title()}</h1>
{#if !sourceCount}
  <p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_sources_body()}</p>
{/if}

<!-- Landscape: adding sources and choosing playback sit side by side instead of stacking into a scroll. -->
<div class="mt-7 grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
  <section aria-labelledby="setup-add-source-title">
    <h2 id="setup-add-source-title" class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.onboarding_sources_add_title()}</h2>
    <form class="mt-3 flex gap-2" onsubmit={(event) => { event.preventDefault(); void add() }}>
      <input bind:value={input} data-focusable aria-label={m.onboarding_sources_add_title()} placeholder={m.onboarding_sources_url_placeholder()} autocomplete="off" autocapitalize="none" spellcheck="false" class="setup-field !min-h-10 flex-1 py-2 text-sm" />
      <button type="submit" data-focusable disabled={adding || !input.trim()} class="setup-inline-button !min-h-10 shrink-0 bg-foreground px-4 py-2 text-sm text-background">
        {#if adding}<LoaderCircle size={15} class="tile-spinner" />{m.onboarding_sources_adding()}{:else}{m.onboarding_sources_add()}{/if}
      </button>
    </form>
    {#if addError}<p bind:this={errorAlert} role="alert" tabindex="-1" class="mt-2 text-xs text-destructive">{addError}</p>{/if}
    <div class="mt-3 flex items-center gap-3 text-sm">
      <span class="text-muted-foreground">{m.onboarding_sources_or()}</span>
      <button type="button" data-focusable onclick={onbrowse} class="setup-inline-button !min-h-10 border border-border px-4 py-2 text-sm"><Store size={15} />{m.onboarding_sources_browse_store()}</button>
    </div>
    <p class="mt-5 flex items-center gap-2 text-sm" role="status" aria-live="polite">
      {#if !sourceCount}<span class="text-muted-foreground">{m.onboarding_sources_none()}</span>
      {:else}
        {#if health === 'checking'}<LoaderCircle size={16} class="tile-spinner shrink-0" />
        {:else if health === 'error'}<TriangleAlert size={16} class="shrink-0 text-destructive" />
        {:else}<Check size={16} class="shrink-0" />{/if}
        <span><span class="font-semibold">{m.onboarding_count_sources({ count: String(sourceCount) })}</span>
          <span class="text-muted-foreground"> · {health === 'checking' ? m.onboarding_checking() : health === 'error' ? m.onboarding_source_unavailable() : m.onboarding_ready()}</span></span>
      {/if}
    </p>
  </section>
  <section>
    <PlaybackChoice bind:checking={checkingKey} />
  </section>
</div>
