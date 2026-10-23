<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import Check from '@lucide/svelte/icons/check'
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import { m } from '$lib/paraglide/messages.js'
  import AddonLogo from '$lib/components/player/AddonLogo.svelte'
  import PlaybackChoice from './PlaybackChoice.svelte'
  import { addonSuggestions, packageSuggestions, type SourceSuggestion } from '$lib/onboarding/source-suggestions'
  import { listCommunityAddons } from '$lib/stremio/community-store'
  import { fetchManifest } from '$lib/stremio/manifest'
  import { addonUrls, disabledSources, normalizeBase } from '$lib/stremio/sources'
  import { OFFICIAL_ANIME_CATALOG, PackageInstalledElsewhereError, fetchExtensionInfo, installCatalogPackage } from '$lib/extensions/manager'
  import type { ExtensionCatalogPackage } from '$lib/extensions/catalog'
  import { disabledExtensions, disabledPlugins, extensionUrls } from '$lib/settings/ui'
  import type { OnboardingIntent } from '$lib/settings/onboarding'

  let { intent, synced = false, busy = $bindable() }: { intent: OnboardingIntent; synced?: boolean; busy: boolean } = $props()

  let loading = $state(true)
  let error = $state('')
  let suggestions = $state<SourceSuggestion[]>([])
  let packages = $state<ExtensionCatalogPackage[]>([])
  let picked = $state<string[]>([])
  let installError = $state('')
  let health = $state<'empty' | 'checking' | 'ready' | 'error'>('empty')
  let installing = $state(false)
  let checkingKey = $state(false)
  let errorAlert = $state<HTMLElement>()
  const abort = new AbortController()

  const configured = $derived($addonUrls.length > 0 || $extensionUrls.length > 0)
  const reviewFace = $derived(synced && configured)

  // Two things hold the footer here: an install in flight and a debrid key still being checked.
  $effect(() => {
    busy = installing || checkingKey
  })

  // The shell's busy flag is bound to this screen. If it unmounts mid-install or mid key check,
  // nothing else would ever clear it, leaving Back disabled on the next screen.
  onDestroy(() => {
    abort.abort()
    busy = false
  })
  onMount(() => {
    // Sources that came over with an import get a health check; everyone gets the picker, which
    // reads as "add more" once sources are already there.
    if (reviewFace) void check()
    void load()
  })

  async function check() {
    const addons = [...$addonUrls]
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

  async function load() {
    loading = true
    error = ''
    try {
      // An empty intent is unreachable through the UI but a stored profile could hold one, and
      // onboardingCatalogPlan answers it with the anime library. Match that rather than showing
      // an empty picker.
      const anime = intent.anime || !intent.films
      const [catalog, community] = await Promise.all([
        anime ? fetchExtensionInfo(OFFICIAL_ANIME_CATALOG).catch(() => null) : Promise.resolve(null),
        intent.films ? listCommunityAddons({ limit: 12, sort: 'stars' }).catch(() => null) : Promise.resolve(null),
      ])
      if (abort.signal.aborted) return
      packages = catalog?.packages ?? []
      suggestions = [
        ...packageSuggestions(packages, 6),
        ...addonSuggestions(community?.addons ?? [], 6),
      ]
      if (!suggestions.length) error = m.onboarding_sources_unavailable()
    } catch (cause) {
      if (!abort.signal.aborted) error = cause instanceof Error ? cause.message : m.onboarding_sources_unavailable()
    } finally {
      if (!abort.signal.aborted) loading = false
    }
  }

  function toggle(id: string) {
    picked = picked.includes(id) ? picked.filter((value) => value !== id) : [...picked, id]
  }

  /**
   * Installs only what the user ticked. Nothing is ticked for them, so izumi never installs a
   * source the user did not choose. The shell's Next calls this; true means it may move on.
   */
  export async function install(): Promise<boolean> {
    if (!picked.length) return true
    if (installing) return false
    installing = true
    installError = ''
    try {
      for (const id of picked) {
        if (abort.signal.aborted) return false
        const suggestion = suggestions.find((entry) => entry.id === id)
        if (!suggestion) continue
        if (suggestion.kind === 'addon') {
          const base = normalizeBase(suggestion.url)
          if (base && !$addonUrls.some((url) => normalizeBase(url) === base)) addonUrls.update((urls) => [...urls, base])
          // A re-run of setup can meet a source the user switched off earlier. Installing it here
          // has to re-enable it, or it lands in the list already disabled and silently does nothing.
          if (base) disabledSources.update((urls) => urls.filter((url) => normalizeBase(url) !== base))
          picked = picked.filter((value) => value !== id)
          continue
        }
        const entry = packages.find((value) => value.id === id)
        if (!entry) continue
        const installed = await installCatalogPackage(entry, OFFICIAL_ANIME_CATALOG).catch((cause: unknown) => {
          // Already installed from another store: setup keeps that copy rather than replacing it.
          if (cause instanceof PackageInstalledElsewhereError) return null
          throw cause
        })
        if (!installed) {
          picked = picked.filter((value) => value !== id)
          continue
        }
        disabledPlugins.update((ids) => ids.filter((value) => value !== installed.id))
        // The package came from the maintained catalog, so keep that catalog in the source list
        // the same way the store screen does when it installs from it.
        if (!$extensionUrls.includes(OFFICIAL_ANIME_CATALOG)) extensionUrls.update((urls) => [...urls, OFFICIAL_ANIME_CATALOG])
        disabledExtensions.update((urls) => urls.filter((spec) => spec !== OFFICIAL_ANIME_CATALOG))
        picked = picked.filter((value) => value !== id)
      }
      if (abort.signal.aborted) return false
      picked = []
      return true
    } catch (cause) {
      if (!abort.signal.aborted) {
        installError = cause instanceof Error ? cause.message : m.onboarding_sources_install_failed()
        // Next disabled itself while installing, which drops focus out of the dialog; the error is
        // also often scrolled out of view under the playback row.
        await tick()
        errorAlert?.focus()
      }
      return false
    } finally {
      if (!abort.signal.aborted) installing = false
    }
  }
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{reviewFace ? m.onboarding_sources_review_title() : m.onboarding_sources_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{reviewFace ? m.onboarding_sources_review_body() : m.onboarding_sources_body()}</p>

{#if reviewFace}
  <div class="mt-7 flex max-w-2xl items-center gap-3 border-y border-border py-5" role="status" aria-live="polite">
    {#if health === 'checking'}<LoaderCircle size={21} class="tile-spinner shrink-0" />
    {:else if health === 'error'}<TriangleAlert size={21} class="shrink-0 text-destructive" />
    {:else}<Check size={21} class="shrink-0" />{/if}
    <div class="min-w-0">
      <p class="font-semibold">{m.onboarding_count_sources({ count: String($addonUrls.length + $extensionUrls.length) })}</p>
      <p class="mt-1 text-sm text-muted-foreground">{health === 'checking' ? m.onboarding_checking() : health === 'error' ? m.onboarding_source_unavailable() : m.onboarding_ready()}</p>
    </div>
  </div>
  <h2 class="mt-8 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.onboarding_sources_add_more()}</h2>
{/if}

{#if loading}
  <p class="mt-7 flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle size={16} class="tile-spinner" />{m.onboarding_sources_loading()}</p>
{:else if error}
  <p class="mt-7 text-sm leading-relaxed text-muted-foreground" role="status">{error}</p>
  <button type="button" data-focusable onclick={() => void load()} class="setup-inline-button mt-4 bg-secondary">{m.onboarding_sources_retry()}</button>
{:else}
  <!-- minmax(0,1fr) is load-bearing: a grid item defaults to min-width:auto, so the implicit
       column sizes to the widest row's max-content. `truncate` sets white-space:nowrap, which
       makes that max-content the full untruncated description — the track blows past the
       container and the text clips at the card edge instead of ellipsising. -->
  <fieldset disabled={installing} class="mt-7 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
    <legend class="sr-only">{m.onboarding_sources_title()}</legend>
    {#each suggestions as suggestion (suggestion.id)}
      <label class="setup-choice flex min-w-0 cursor-pointer items-center gap-3 p-4 {picked.includes(suggestion.id) ? 'selected' : ''}">
        <input type="checkbox" data-focusable class="shrink-0" checked={picked.includes(suggestion.id)} onchange={() => toggle(suggestion.id)} />
        <AddonLogo logo={suggestion.logo} name={suggestion.name} id={suggestion.id} size={32} />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold">{suggestion.name}</span>
          <span class="mt-0.5 block truncate text-xs text-muted-foreground">{suggestion.description}</span>
        </span>
      </label>
    {/each}
  </fieldset>
  <p class="mt-3 flex items-center gap-2 text-xs leading-relaxed text-muted-foreground" role="status">
    {#if installing}<LoaderCircle size={14} class="tile-spinner" />{m.onboarding_sources_installing()}
    {:else if picked.length}{m.onboarding_sources_picked({ count: String(picked.length) })}
    {:else}{m.onboarding_sources_none_selected()}{/if}
  </p>
{/if}
{#if installError}<p bind:this={errorAlert} role="alert" tabindex="-1" class="mt-3 text-sm text-destructive">{installError}</p>{/if}

<PlaybackChoice bind:checking={checkingKey} />
