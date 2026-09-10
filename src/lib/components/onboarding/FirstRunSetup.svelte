<script lang="ts">
  import Wordmark from '$lib/components/Wordmark.svelte'
  import SetupArtwork from './SetupArtwork.svelte'
  import StremioSetup from './StremioSetup.svelte'
  import { stremioAuthKey } from '$lib/stremio/account'
  import { stremioAddonSyncState } from '$lib/stremio/account-sync'
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import Check from '@lucide/svelte/icons/check'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import CircleHelp from '@lucide/svelte/icons/circle-help'
  import Eye from '@lucide/svelte/icons/eye'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Film from '@lucide/svelte/icons/film'
  import History from '@lucide/svelte/icons/history'
  import LibraryBig from '@lucide/svelte/icons/library-big'
  import Play from '@lucide/svelte/icons/play'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import { fetchExtensionInfo } from '$lib/extensions/manager'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import { PLAYBACK_LANGUAGES } from '$lib/shared/languages'
  import { m } from '$lib/paraglide/messages.js'
  import {
    catalogDefaultProvider,
    catalogLastScreen,
    catalogProviders,
    omdbApiKey,
    resolveCatalogScreenStartup,
    selectCatalogScreen,
    tmdbReadToken,
  } from '$lib/settings/catalog'
  import {
    finishOnboarding,
    onboardingCatalogPlan,
    onboardingSteps,
    onboardingComplete,
    type OnboardingIntent,
    type OnboardingMovieMetadata,
    type OnboardingStartupLibrary,
  } from '$lib/settings/onboarding'
  import { debridKey, extensionUrls, preferredAudioLang, preferredSubLang } from '$lib/settings/ui'
  import { fetchManifest } from '$lib/stremio/manifest'
  import {
    addonUrls,
    CINEMETA_BASE,
    disabledSources,
    normalizeBase,
    replaceAddonBase,
  } from '$lib/stremio/sources'
  import { anilistToken, kitsuToken, malToken, simklToken } from '$lib/trackers/config'

  const tmdbSettingsUrl = 'https://www.themoviedb.org/settings/api'
  const omdbSettingsUrl = 'https://www.omdbapi.com/apikey.aspx'
  const initialProvider = get(catalogDefaultProvider)
  const initialProviders = get(catalogProviders)
  const initialBoth = initialProvider === 'merged' || (initialProviders.includes('auto') && initialProviders.some(provider => provider === 'tmdb' || provider === 'stremio'))

  let root = $state<HTMLElement>()
  let step = $state(0)
  let stremioBusy = $state(false)
  let keyboardOpen = $state(false)
  let intent = $state<OnboardingIntent>({
    anime: initialBoth || !(initialProvider === 'tmdb' || initialProvider === 'stremio'),
    films: initialBoth || initialProvider === 'tmdb' || initialProvider === 'stremio',
  })
  const focus = $derived(intent.anime && intent.films ? 'both' : intent.films ? 'movies' : 'anime')
  let movieMetadata = $state<OnboardingMovieMetadata>(initialProvider === 'stremio' || (initialProviders.includes('stremio') && !initialProviders.includes('tmdb')) ? 'stremio' : 'tmdb')
  let startupLibrary = $state<OnboardingStartupLibrary>(initialProvider === 'adaptive' ? 'adaptive' : initialBoth && initialProvider === 'auto' ? 'auto' : initialBoth && (initialProvider === 'tmdb' || initialProvider === 'stremio') ? 'movies' : 'merged')
  let tmdbToken = $state(get(tmdbReadToken))
  let ratingsKey = $state(get(omdbApiKey))
  let audioLanguage = $state(get(preferredAudioLang))
  let subtitleLanguage = $state(get(preferredSubLang))
  let showTmdbToken = $state(false)
  let showRatingsKey = $state(false)
  let externalError = $state('')
  let sourceHealth = $state<'empty' | 'checking' | 'ready' | 'error'>('empty')

  const sourceConfigured = $derived($addonUrls.length > 0 || $extensionUrls.length > 0)
  const trackerReady = $derived(Boolean($anilistToken || $malToken || $kitsuToken || $simklToken))
  const debridReady = $derived(Boolean($debridKey))
  const selectedProvider = $derived(!intent.films ? m.onboarding_automatic_anime() : (intent.anime ? m.onboarding_automatic_anime() + ' + ' : '') + (movieMetadata === 'tmdb' ? 'TMDB' : 'Stremio'))
  const startupChoices = $derived([
    { id: 'movies', title: movieMetadata === 'tmdb' ? 'TMDB' : 'Stremio', body: m.onboarding_startup_movies_body(), Icon: Film },
    { id: 'auto', title: m.onboarding_automatic_anime(), body: m.onboarding_startup_anime_body(), Icon: Sparkles },
    { id: 'merged', title: m.onboarding_startup_merged(), body: m.onboarding_startup_merged_body(), Icon: LibraryBig },
    { id: 'adaptive', title: m.onboarding_startup_adaptive(), body: m.onboarding_startup_adaptive_body(), Icon: History },
  ])
  const selectedStartup = $derived(startupChoices.find(choice => choice.id === startupLibrary)?.title)
  const steps = $derived(!intent.films ? [0, 1, 2, 6, 7] : intent.anime ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 6, 7])
  const totalSteps = $derived(steps.length)
  const stepIndex = $derived(steps.indexOf(step))


  function goBack() {
    if (!stremioBusy && stepIndex > 0) step = steps[stepIndex - 1]
  }

  function goNext() {
    if (!stremioBusy && stepIndex < steps.length - 1) step = steps[stepIndex + 1]
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      goBack()
      return
    }
    if (event.key !== 'Tab' || !root) return
    const focusable = [...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.offsetParent !== null).filter((element, _, candidates) => {
      // Native radio groups have one tab stop: the checked radio (or the first when unset).
      if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name) return true
      const group = candidates.filter((candidate): candidate is HTMLInputElement =>
        candidate instanceof HTMLInputElement && candidate.type === 'radio' && candidate.name === element.name)
      return element === (group.find(radio => radio.checked) ?? group[0])
    })
    if (!focusable.length) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function openExternal(url: string) {
    externalError = ''
    try {
      await openUrl(url)
    } catch (cause) {
      externalError = cause instanceof Error ? cause.message : m.onboarding_external_error()
    }
  }

  async function checkSources(addons: string[], extensions: string[]) {
    if (!addons.length && !extensions.length) {
      sourceHealth = 'empty'
      return
    }
    sourceHealth = 'checking'
    const checks = await Promise.all([
      ...addons.map(async (url) => Boolean(await fetchManifest(url).catch(() => null))),
      ...extensions.map(async (url) => {
        const info = await fetchExtensionInfo(url).catch(() => null)
        return Boolean(info && (info.configs.length > 0 || info.packages?.length))
      }),
    ])
    sourceHealth = checks.some(Boolean) ? 'ready' : 'error'
  }

  function applyProfile() {
    preferredAudioLang.set(audioLanguage)
    preferredSubLang.set(subtitleLanguage)
    const plan = onboardingCatalogPlan(intent, movieMetadata, startupLibrary)
    catalogProviders.set(plan.providers)
    catalogDefaultProvider.set(plan.defaultProvider)
    selectCatalogScreen(resolveCatalogScreenStartup(plan.defaultProvider, get(catalogLastScreen), plan.providers))

    if (intent.films && movieMetadata === 'tmdb') {
      tmdbReadToken.set(tmdbToken.trim())
      omdbApiKey.set(ratingsKey.trim())
    }
    if (intent.films && movieMetadata === 'stremio') {
      addonUrls.update((urls) => replaceAddonBase(urls, undefined, CINEMETA_BASE))
      disabledSources.update((urls) => urls.filter((url) => normalizeBase(url) !== normalizeBase(CINEMETA_BASE)))
    }
  }

  function complete() {
    applyProfile()
    finishOnboarding()
  }

  function skip() {
    finishOnboarding()
  }

  async function openSettings(path: string) {
    applyProfile()
    finishOnboarding()
    await goto(path)
  }

  $effect(() => {
    if (step === 6) void checkSources([...$addonUrls], [...$extensionUrls])
  })

  $effect(() => {
    if ($onboardingComplete) return
    step
    const frame = requestAnimationFrame(() => {
      root?.querySelector('.setup-step')?.scrollTo({ top: 0 })
      root?.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  })

  $effect(() => {
    if ($onboardingComplete) return
    step = 0
    const previousFocus = document.activeElement as HTMLElement | null
    const htmlOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = htmlOverflow
      document.body.style.overflow = bodyOverflow
      previousFocus?.focus({ preventScroll: true })
    }
  })
  onMount(() => {
    const viewport = window.visualViewport
    const updateViewport = () => {
      if (!viewport || !root) return
      root.style.setProperty('--setup-viewport-height', `${viewport.height}px`)
      root.style.setProperty('--setup-viewport-top', `${viewport.offsetTop}px`)
      keyboardOpen = viewport.height < window.innerHeight * .75
    }
    updateViewport()
    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    return () => {
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
    }
  })
</script>

{#snippet heading(title: string, body: string)}
  <h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading font-bold tracking-tight">{title}</h1>
  <p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{body}</p>
{/snippet}

{#if !$onboardingComplete}
  <div bind:this={root} role="dialog" aria-modal="true" aria-labelledby="setup-title" tabindex="-1" data-nav-trap class:welcome={step === 0} class:keyboard-open={keyboardOpen} class="onboarding-surface fixed inset-0 z-[160] flex h-[100dvh] w-screen flex-col overflow-hidden bg-background text-foreground" onkeydown={handleKeydown}>
    <span id="setup-progress" class="sr-only">{m.onboarding_step_count({ current: String(stepIndex + 1), total: String(totalSteps) })}</span>
    <div class="setup-stage min-h-0 flex-1">
      <aside class="setup-art-panel" aria-hidden="true">
        <SetupArtwork mode={step <= 1 ? 'both' : focus} />
        <div class="art-wordmark"><Wordmark /></div>
      </aside>
      <main class="setup-main min-w-0">
        <div class="setup-step">
          {#key step}
          <section class="setup-content">
            {#if step === 0}
              {@render heading(m.onboarding_welcome_title(), m.onboarding_welcome_body())}
              <div class="welcome-details"><span><Sparkles size={22} />{m.onboarding_anime_title()}</span><span><Film size={22} />{m.onboarding_movies_title()}</span><span><LibraryBig size={22} />{m.onboarding_change_later_hint()}</span></div>
              <p class="mt-8 text-xs leading-relaxed text-muted-foreground">{m.onboarding_once_detail()}</p>
            {:else if step === 1}
              {@render heading(m.onboarding_stremio_sync_title(), m.onboarding_stremio_sync_body())}
              <StremioSetup bind:busy={stremioBusy} />
            {:else if step === 2}
              {@render heading(m.onboarding_focus_title(), m.onboarding_focus_body())}
              <div class="mt-7 space-y-3">
                {#each [{ id: 'anime', title: m.onboarding_anime_title(), body: m.onboarding_automatic_body(), Icon: Sparkles }, { id: 'movies', title: m.onboarding_movies_title(), body: m.onboarding_movies_body(), Icon: Film }, { id: 'both', title: m.onboarding_both_title(), body: m.onboarding_both_body(), Icon: LibraryBig }] as choice}
                  <button type="button" data-focusable onclick={() => intent = choice.id === 'both' ? { anime: true, films: true } : { anime: choice.id === 'anime', films: choice.id === 'movies' }} aria-pressed={focus === choice.id} class="setup-choice flex w-full items-center gap-4 p-5 text-left {focus === choice.id ? 'selected' : ''}">
                    <choice.Icon size={24} class="shrink-0 text-muted-foreground" />
                    <span class="min-w-0 flex-1"><span class="block text-lg font-semibold">{choice.title}</span><span class="mt-1 block text-sm leading-relaxed text-muted-foreground">{choice.body}</span></span>
                    <span class="grid size-5 shrink-0 place-items-center rounded-full border border-foreground/40">{#if focus === choice.id}<Check size={13} />{/if}</span>
                  </button>
                {/each}
              </div>
            {:else if step === 3}
              {@render heading(m.onboarding_metadata_title(), m.onboarding_metadata_body())}
              {#if focus === 'both'}<p class="mt-5 flex items-start gap-2 text-sm"><Sparkles size={17} class="mt-0.5 shrink-0" />{m.onboarding_both_included()}</p>{/if}
              <div class="mt-6 grid gap-3 sm:grid-cols-2">
                <button type="button" data-focusable onclick={() => movieMetadata = 'tmdb'} aria-pressed={movieMetadata === 'tmdb'} class="setup-choice p-5 text-left {movieMetadata === 'tmdb' ? 'selected' : ''}">
                  <span class="flex items-center justify-between gap-3"><img src="/brand/tmdb.svg" alt="TMDB" class="h-7 w-auto max-w-24" /><span class="text-xs text-muted-foreground">{m.onboarding_recommended()}</span></span>
                  <span class="mt-6 block text-xl font-semibold">{m.onboarding_tmdb_title()}</span><span class="mt-2 block text-sm leading-relaxed text-muted-foreground">{m.onboarding_tmdb_body()}</span>
                </button>
                <button type="button" data-focusable onclick={() => movieMetadata = 'stremio'} aria-pressed={movieMetadata === 'stremio'} class="setup-choice p-5 text-left {movieMetadata === 'stremio' ? 'selected' : ''}">
                  <Play size={27} class="text-muted-foreground" />
                  <span class="mt-6 block text-xl font-semibold">{m.onboarding_stremio_title()}</span><span class="mt-2 block text-sm leading-relaxed text-muted-foreground">{m.onboarding_stremio_body()}</span>
                </button>
              </div>
              {#if movieMetadata === 'stremio'}<p class="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><CircleHelp size={16} class="shrink-0" />{m.onboarding_stremio_warning()}</p>{/if}
            {:else if step === 4}
              {#if movieMetadata === 'tmdb'}
                {@render heading(m.onboarding_tmdb_access_title(), m.onboarding_tmdb_access_body())}
                <details class="mt-7 rounded-xl border border-border p-5">
                  <summary class="cursor-pointer font-semibold">{m.onboarding_access_expand()}<span class="ml-3 text-xs font-normal text-muted-foreground">{tmdbToken.trim() ? m.onboarding_tmdb_token_saved() : m.onboarding_optional_now()}</span></summary>
                  <div class="mt-5">
                    <label for="setup-tmdb-token" class="text-sm font-semibold">{m.onboarding_tmdb_token_label()}</label>
                    <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{m.onboarding_access_draft()}</p>
                    <div class="relative mt-3">
                      <input id="setup-tmdb-token" data-focusable bind:value={tmdbToken} type={showTmdbToken ? 'text' : 'password'} autocomplete="off" spellcheck="false" class="h-12 w-full rounded-lg bg-input px-3 pr-12 font-mono text-sm" placeholder="eyJhbGciOiJIUzI1NiJ9…" />
                      <button type="button" data-focusable onclick={() => showTmdbToken = !showTmdbToken} aria-label={showTmdbToken ? m.onboarding_hide_key() : m.onboarding_show_key()} class="absolute right-1 top-1 grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-secondary">{#if showTmdbToken}<EyeOff size={17} />{:else}<Eye size={17} />{/if}</button>
                    </div>
                    <details class="mt-5 border-t border-border pt-4">
                      <summary class="cursor-pointer text-sm">{m.onboarding_access_help()}</summary>
                      <ol class="mt-4 list-decimal space-y-3 pl-5 text-xs leading-relaxed text-muted-foreground">
                        {#each [m.onboarding_tmdb_instruction_1(), m.onboarding_tmdb_instruction_2(), m.onboarding_tmdb_instruction_3(), m.onboarding_tmdb_instruction_4()] as instruction}<li>{instruction}</li>{/each}
                      </ol>
                      <button type="button" data-focusable onclick={() => void openExternal(tmdbSettingsUrl)} class="setup-button mt-4 bg-secondary"><ExternalLink size={15} />{m.onboarding_open_tmdb()}</button>
                    </details>
                  </div>
                </details>
                <details class="mt-3 border-b border-border px-1 py-4">
                  <summary class="cursor-pointer text-sm text-muted-foreground">{m.onboarding_ratings_expand()}</summary>
                  <div class="mt-4">
                    <label for="setup-ratings-key" class="text-sm font-semibold">{m.onboarding_omdb_key_label()}</label><p class="mt-2 text-xs leading-relaxed text-muted-foreground">{m.onboarding_omdb_key_hint()}</p>
                    <div class="relative mt-3">
                      <input id="setup-ratings-key" data-focusable bind:value={ratingsKey} type={showRatingsKey ? 'text' : 'password'} autocomplete="off" spellcheck="false" class="h-12 w-full rounded-lg bg-input px-3 pr-12 font-mono text-sm" />
                      <button type="button" data-focusable onclick={() => showRatingsKey = !showRatingsKey} aria-label={showRatingsKey ? m.onboarding_hide_key() : m.onboarding_show_key()} class="absolute right-1 top-1 grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-secondary">{#if showRatingsKey}<EyeOff size={17} />{:else}<Eye size={17} />{/if}</button>
                    </div>
                    <button type="button" data-focusable onclick={() => void openExternal(omdbSettingsUrl)} class="setup-button mt-3 bg-secondary"><ExternalLink size={15} />{m.onboarding_get_omdb()}</button>
                  </div>
                </details>
                <div class="mt-7 flex items-center gap-4"><img src="/brand/tmdb.svg" alt="TMDB" class="h-5 w-auto max-w-20 shrink-0" /><p class="text-xs leading-relaxed text-muted-foreground">{m.onboarding_tmdb_attribution()}</p></div>
                {#if externalError}<p class="mt-3 text-sm text-destructive" role="alert">{externalError}</p>{/if}
              {:else}
                {@render heading(m.onboarding_stremio_access_title(), m.onboarding_stremio_access_body())}
                <p class="mt-7 flex items-start gap-3 border-b border-border pb-6 text-sm leading-relaxed"><Check size={20} class="shrink-0" />{m.onboarding_no_key_body()}</p>
                <h2 class="mt-6 text-sm font-semibold">{m.onboarding_stremio_limit_title()}</h2><p class="mt-2 text-sm leading-relaxed text-muted-foreground">{m.onboarding_stremio_limit_body()}</p>
              {/if}
            {:else if step === 5}
              {@render heading(m.onboarding_startup_title(), m.onboarding_startup_body())}
              <fieldset class="mt-7 grid gap-3 sm:grid-cols-2">
                <legend class="sr-only">{m.onboarding_startup_title()}</legend>
                {#each startupChoices as choice}
                  <label class="setup-choice startup-choice flex items-center gap-3 cursor-pointer p-4 {startupLibrary === choice.id ? 'selected' : ''}">
                    <input type="radio" name="startup-library" value={choice.id} bind:group={startupLibrary} data-focusable class="sr-only" />
                    <choice.Icon size={22} class="shrink-0 text-muted-foreground" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-base font-semibold">{choice.title}</span>
                      <span class="mt-1 block text-sm leading-relaxed text-muted-foreground">{choice.body}</span>
                    </span>
                    <span class="grid size-5 shrink-0 place-items-center rounded-full border border-foreground/40">{#if startupLibrary === choice.id}<Check size={13} />{/if}</span>
                  </label>
                {/each}
              </fieldset>
            {:else if step === 6}
              {@render heading(m.onboarding_preferences_title(), m.onboarding_preferences_body())}
              <div class="mt-7 grid gap-4 sm:grid-cols-2">
                <label class="grid gap-2 text-sm font-semibold">{m.player_audio_language()}<SelectMenu bind:value={audioLanguage} ariaLabel={m.player_audio_language()} searchable options={PLAYBACK_LANGUAGES} /></label>
                <label class="grid gap-2 text-sm font-semibold">{m.player_subtitle_language()}<SelectMenu bind:value={subtitleLanguage} ariaLabel={m.player_subtitle_language()} searchable options={[...PLAYBACK_LANGUAGES.slice(0, 2), { value: 'none', label: m.cast_subtitles_off() }, ...PLAYBACK_LANGUAGES.slice(2)]} /></label>
              </div>
              <h2 class="mt-9 text-base font-semibold">{m.onboarding_connections_title()}</h2><p class="mt-2 text-sm text-muted-foreground">{m.onboarding_connections_body()}</p>
              <div class="mt-4 divide-y divide-border border-y border-border">
                <div class="flex flex-wrap items-center gap-3 py-4">
                  <LibraryBig size={19} class="text-muted-foreground" /><span class="min-w-40 flex-1"><span class="block text-sm font-semibold">{m.onboarding_sources()}</span><span class="mt-1 block text-xs text-muted-foreground">{sourceHealth === 'checking' ? m.onboarding_checking() : sourceHealth === 'ready' ? m.onboarding_ready() : sourceHealth === 'error' ? m.onboarding_source_unavailable() : m.onboarding_needs_source()}</span></span>
                  {#if !sourceConfigured || sourceHealth === 'error'}<button type="button" data-focusable onclick={() => void openSettings('/app/settings/sources')} title={m.onboarding_finish_settings()} class="setup-button bg-secondary">{m.onboarding_open_sources()}<ArrowRight size={14} /></button>{/if}
                </div>
                {#each [{ label: m.onboarding_tracker(), ready: trackerReady, path: '/app/settings/accounts' }, { label: m.onboarding_debrid(), ready: debridReady, path: '/app/settings/sources' }] as item}
                  <div class="flex flex-wrap items-center gap-3 py-4"><Check size={19} class="text-muted-foreground" /><span class="min-w-40 flex-1"><span class="block text-sm font-semibold">{item.label}</span><span class="mt-1 block text-xs text-muted-foreground">{item.ready ? m.onboarding_ready() : m.onboarding_optional()}</span></span>{#if !item.ready}<button type="button" data-focusable onclick={() => void openSettings(item.path)} title={m.onboarding_finish_settings()} class="setup-button bg-secondary">{m.onboarding_open_accounts()}<ArrowRight size={14} /></button>{/if}</div>
                {/each}
              </div>
              <p class="mt-4 text-xs text-muted-foreground">{m.onboarding_finish_settings()}</p>
            {:else}
              {@render heading(m.onboarding_review_title(), m.onboarding_review_body())}
              <dl class="mt-7 divide-y divide-border border-y border-border">
                <div class="py-5"><dt class="text-xs text-muted-foreground">{m.onboarding_focus_summary()}</dt><dd class="mt-1 text-lg font-semibold">{focus === 'both' ? m.onboarding_both_title() : focus === 'anime' ? m.onboarding_anime_title() : m.onboarding_movies_title()}</dd></div>
                <div class="py-5"><dt class="text-xs text-muted-foreground">{m.onboarding_catalog_summary()}</dt><dd class="mt-1 text-lg font-semibold">{selectedProvider}</dd></div>
                {#if focus === 'both'}<div class="py-5"><dt class="text-xs text-muted-foreground">{m.onboarding_startup_summary()}</dt><dd class="mt-1 text-lg font-semibold">{selectedStartup}</dd>{#if startupLibrary === 'adaptive'}<dd class="mt-1 text-sm text-muted-foreground">{m.onboarding_startup_adaptive_body()}</dd>{/if}</div>{/if}
                {#if focus !== 'anime' && movieMetadata === 'tmdb'}<div class="py-5"><dt class="text-xs text-muted-foreground">{m.onboarding_optional_access_summary()}</dt><dd class="mt-1 text-sm">{tmdbToken.trim() ? m.onboarding_tmdb_token_saved() : m.onboarding_add_later()}</dd></div>{/if}
                <div class="py-5"><dt class="text-xs text-muted-foreground">{m.onboarding_stremio_sources_summary()}</dt><dd class="mt-1 text-sm">{$stremioAddonSyncState.state === 'synced' ? m.onboarding_stremio_synced({ count: String($stremioAddonSyncState.count) }) : $stremioAuthKey ? m.onboarding_stremio_sync_pending() : m.onboarding_stremio_skipped()}</dd></div>
              </dl>
              <p class="mt-6 text-xs leading-relaxed text-muted-foreground">{m.onboarding_review_once_hint()}</p>
            {/if}
          </section>
          {/key}
        </div>
        <footer class="setup-actions flex items-center justify-between gap-3">
          {#if step === 0}<button type="button" data-focusable onclick={skip} class="setup-button text-muted-foreground hover:bg-secondary">{m.onboarding_skip()}</button>
          {:else}<button type="button" data-focusable onclick={goBack} disabled={stremioBusy} class="setup-button hover:bg-secondary"><ChevronLeft size={17} />{m.onboarding_back()}</button>{/if}
          {#if step < 7}<button type="button" data-focusable onclick={goNext} disabled={stremioBusy} class="setup-button bg-foreground text-background">{step === 0 ? m.onboarding_start() : step === 1 && !$stremioAuthKey ? m.onboarding_stremio_continue_without() : m.onboarding_next()}<ArrowRight size={17} /></button>
          {:else}<button type="button" data-focusable onclick={complete} class="setup-button bg-foreground text-background"><Check size={17} />{m.onboarding_finish()}</button>{/if}
        </footer>
      </main>
    </div>
  </div>
{/if}

<style>
  .setup-stage { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); }
  .setup-art-panel { grid-column: 2; grid-row: 1; position: relative; overflow: hidden; background: #111216; }
  .art-wordmark { position: absolute; bottom: max(2.5rem, env(safe-area-inset-bottom)); right: max(2.5rem, env(safe-area-inset-right)); display: flex; color: white; }
  .setup-main { grid-column: 1; grid-row: 1; min-height: 0; display: flex; flex-direction: column; justify-content: safe center; padding: max(2.5rem, env(safe-area-inset-top)) clamp(1.5rem, 4.5vw, 5rem) max(2.5rem, env(safe-area-inset-bottom)); }
  .setup-step { min-height: 0; overflow-y: auto; overscroll-behavior: contain; width: 100%; max-width: 36rem; margin-inline: auto; padding: 4px; scroll-behavior: auto; }
  .setup-heading { font-size: clamp(1.8rem, 2.8vw, 2.75rem); line-height: 1.15; text-wrap: balance; }
  /* Headings receive focus for screen-reader orientation, not as an interactive control. */
  .setup-heading:focus { outline: none; box-shadow: none; }
  .setup-content { animation: step-enter 320ms cubic-bezier(.2, .7, .2, 1) both; }
  .setup-actions { flex-shrink: 0; width: 100%; max-width: 36rem; margin-inline: auto; margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid hsl(var(--border) / .65); }
  .welcome-details { display: grid; gap: 1.4rem; margin-top: 2rem; }
  .welcome-details span { display: flex; align-items: center; gap: 1rem; font-size: .95rem; }
  .welcome-details :global(svg) { flex-shrink: 0; color: hsl(var(--muted-foreground)); }
  @keyframes step-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .onboarding-surface { height: var(--setup-viewport-height, 100dvh); top: var(--setup-viewport-top, 0px); width: 100%; }
    .setup-stage { position: relative; display: flex; }
    .setup-art-panel { position: absolute; inset: 0; pointer-events: none; }
    .setup-art-panel::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, hsl(var(--background) / .12), hsl(var(--background) / .94) 24%, hsl(var(--background)) 65%); }
    .art-wordmark { z-index: 1; top: max(1.5rem, env(safe-area-inset-top)); bottom: auto; left: max(1.5rem, env(safe-area-inset-left)); right: auto; }
    .setup-main { z-index: 1; width: 100%; justify-content: flex-start; padding: max(6rem, calc(env(safe-area-inset-top) + 4.5rem)) max(1.5rem, env(safe-area-inset-right)) 0 max(1.5rem, env(safe-area-inset-left)); }
    .setup-step { flex: 1; max-width: 34rem; padding: 4px 4px 1rem; }
    .setup-heading { font-size: clamp(1.9rem, 7.5vw, 2.6rem); }
    .setup-content :global(.text-sm) { font-size: 14px; }
    .setup-content :global(.text-xs) { font-size: 12px; }
    .setup-actions { max-width: 34rem; margin-top: 0; padding: 1rem 0 max(1rem, env(safe-area-inset-bottom)); background: hsl(var(--background)); }
    .setup-actions .setup-button { min-height: 48px; font-size: 14px; }
    .setup-actions .setup-button:last-child { max-width: 72%; }
    .welcome .setup-main { padding-top: max(6rem, 34dvh); }
    .welcome .setup-art-panel::after { background: linear-gradient(180deg, hsl(var(--background) / .08), hsl(var(--background) / .25) 15%, hsl(var(--background) / .96) 40%, hsl(var(--background)) 75%); }
    .welcome .setup-step { display: flex; align-items: safe center; }
    .welcome-details { gap: 1rem; margin-top: 1.5rem; }
    .keyboard-open .setup-main { padding-top: max(1rem, env(safe-area-inset-top)); }
    .keyboard-open .art-wordmark { display: none; }
    .keyboard-open .setup-art-panel::after { background: hsl(var(--background) / .97); }
  }
  @media (max-height: 600px) and (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .welcome .setup-main { padding-top: max(5rem, calc(env(safe-area-inset-top) + 3.5rem)); }
    .setup-actions { padding-top: .6rem; }
  }
  .setup-choice { border: 1px solid hsl(var(--border)); border-radius: .75rem; transition: background 150ms, border-color 150ms; }
  .startup-choice:has(input:focus-visible) { outline: 2px solid hsl(var(--foreground)); outline-offset: 3px; }
  .setup-choice:hover { background: hsl(var(--secondary)); }
  .setup-choice.selected { border-color: hsl(var(--foreground) / .6); background: hsl(var(--foreground) / .05); }
  .setup-button { display: inline-flex; min-height: 2.75rem; align-items: center; justify-content: center; gap: .5rem; border-radius: .5rem; padding: .65rem 1rem; font-size: .85rem; font-weight: 600; transition: background 180ms, transform 180ms; }
  .setup-button:disabled { opacity: .5; cursor: wait; }
  .setup-button:active { transform: translateY(1px); }
  .onboarding-surface button:focus-visible, .onboarding-surface input:focus-visible, .onboarding-surface summary:focus-visible { outline: 2px solid hsl(var(--foreground)); outline-offset: 3px; }
  @media (prefers-reduced-motion: reduce) { .setup-choice, .setup-button { transition: none; } .setup-content { animation: none; } }
</style>
