<script lang="ts">
  import Wordmark from '$lib/components/Wordmark.svelte'
  import IntroSequence, { introAlreadyPlayed } from './IntroSequence.svelte'
  import SetupArtwork from './SetupArtwork.svelte'
  import WatchStep from './steps/WatchStep.svelte'
  import MetadataStep from './steps/MetadataStep.svelte'
  import AccessStep from './steps/AccessStep.svelte'
  import StartupStep from './steps/StartupStep.svelte'
  import ConnectStep from './steps/ConnectStep.svelte'
  import SyncStep from './steps/SyncStep.svelte'
  import SourcesStep from './steps/SourcesStep.svelte'
  import PlaybackStep from './steps/PlaybackStep.svelte'
  import TransferStep from './steps/TransferStep.svelte'
  import { gameMode, gameModeResolved, onboardingNav } from '$lib/player/session'
  import ReadyStep from './steps/ReadyStep.svelte'
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import Check from '@lucide/svelte/icons/check'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone'
  import SkipForward from '@lucide/svelte/icons/skip-forward'
  import { m } from '$lib/paraglide/messages.js'
  import { anyConnected, idleConnectStates, type ConnectStates } from '$lib/onboarding/connect-state'
  import type { SetupReadiness } from '$lib/onboarding/readiness'
  import { defaultPlaybackLanguages } from '$lib/onboarding/playback-languages'
  import type { NuvioExtras } from '$lib/onboarding/sync-receipt'
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
    type StepId,
  } from '$lib/settings/onboarding'
  import { debridKey, extensionUrls, preferredAudioLang, preferredSubLang, torrentPlaybackMode, type AudioLang, type SubLang } from '$lib/settings/ui'
  import { addonUrls, CINEMETA_BASE, disabledSources, normalizeBase, replaceAddonBase } from '$lib/stremio/sources'
  import { anilistToken, kitsuToken, malToken, simklToken } from '$lib/trackers/config'

  const initialProvider = get(catalogDefaultProvider)
  const initialProviders = get(catalogProviders)
  const initialBoth = initialProvider === 'merged' || (initialProviders.includes('auto') && initialProviders.some(provider => provider === 'tmdb' || provider === 'stremio'))

  let root = $state<HTMLElement>()
  // Only a brand-new install ever reaches this component, so the ident needs no flag of its own —
  // "setup has not finished" is already the definition of a new user.
  let introRunning = $state(!introAlreadyPlayed())
  // Game mode means a Steam Deck, where typing a TMDB token and picking languages on a touch
  // keyboard is the worst version of this flow. There, setting up from a device that is already
  // configured is the default answer, and the wizard is the escape hatch rather than the reverse.
  let mode = $state<'wizard' | 'transfer'>('wizard')
  let modeSettled = false
  let step = $state<StepId>('watch')
  let busy = $state(false)
  let keyboardOpen = $state(false)

  let intent = $state<OnboardingIntent>({
    anime: initialBoth || !(initialProvider === 'tmdb' || initialProvider === 'stremio'),
    films: initialBoth || initialProvider === 'tmdb' || initialProvider === 'stremio',
  })
  let movieMetadata = $state<OnboardingMovieMetadata>(initialProvider === 'stremio' || (initialProviders.includes('stremio') && !initialProviders.includes('tmdb')) ? 'stremio' : 'tmdb')
  let startupLibrary = $state<OnboardingStartupLibrary>(initialProvider === 'adaptive' ? 'adaptive' : initialBoth && initialProvider === 'auto' ? 'auto' : initialBoth && (initialProvider === 'tmdb' || initialProvider === 'stremio') ? 'movies' : 'merged')
  let tmdbToken = $state(get(tmdbReadToken))
  let ratingsKey = $state(get(omdbApiKey))
  let connections = $state<ConnectStates>(idleConnectStates())
  let nuvioExtras = $state<NuvioExtras>({ library: false, progress: false, history: false })
  let syncImported = $state(false)

  const connected = $derived(anyConnected(connections))
  const sourceReady = $derived($addonUrls.length > 0 || $extensionUrls.length > 0)
  const steps = $derived(onboardingSteps(connected, intent, movieMetadata, sourceReady))
  const stepIndex = $derived(steps.indexOf(step))
  const totalSteps = $derived(steps.length)
  /** Nothing chosen means nothing to set up, so the watch screen holds the flow until one is. */
  const blocked = $derived(step === 'watch' && !intent.anime && !intent.films)
  const trackerReady = $derived(Boolean($anilistToken || $malToken || $kitsuToken || $simklToken))
  const metadataReady = $derived(!intent.films || movieMetadata === 'stremio' || tmdbToken.trim().length > 0)
  // Having sources counts: the playback screen is skipped in that case, so reporting it as
  // unfinished would nag about a question setup deliberately never asked.
  const playbackReady = $derived($torrentPlaybackMode === 'direct' || Boolean($debridKey) || sourceReady)
  const readiness = $derived<SetupReadiness>({ sources: sourceReady, playback: playbackReady, tracker: trackerReady, metadata: metadataReady })

  function enterTransfer() {
    modeSettled = true
    mode = 'transfer'
  }

  function leaveTransfer() {
    modeSettled = true
    mode = 'wizard'
  }

  /** A finished transfer already carries sources, settings and history, so there is nothing left
   *  for the wizard to ask. */
  async function completeTransfer() {
    finishOnboarding()
    await goto('/app/home')
  }

  // `gameMode` resolves asynchronously, so the default cannot be read at initialization. Settled
  // once, and never against a choice the user has already made by hand.
  $effect(() => {
    if (modeSettled || !$gameModeResolved) return
    modeSettled = true
    if ($gameMode) mode = 'transfer'
  })

  function goBack() {
    if (!busy && stepIndex > 0) step = steps[stepIndex - 1]
  }

  /** Switching to the keyless provider deletes this very screen from the step list, so the
   *  destination has to be read before the change or stepIndex lands on -1. */
  function useStremioMetadata() {
    const next = steps[stepIndex + 1] ?? 'connect'
    movieMetadata = 'stremio'
    step = next
  }

  function goNext() {
    if (!busy && !blocked && stepIndex < steps.length - 1) step = steps[stepIndex + 1]
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

  function applyProfile() {
    // Derived rather than asked: an anime library implies Japanese audio with English subtitles,
    // anything else follows the system language.
    const languages = defaultPlaybackLanguages(intent, navigator.language)
    preferredAudioLang.set(languages.audio as AudioLang)
    preferredSubLang.set(languages.subtitle as SubLang)
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

  async function complete() {
    applyProfile()
    finishOnboarding()
    await goto('/app/home')
  }

  function skip() {
    // Nothing is recorded about what was left undone. Settings → Interface reruns setup, and the
    // Sources and Accounts screens each say what they still need.
    finishOnboarding()
  }

  // A change on an earlier screen can remove the current one from the list entirely. Falling back
  // to the last still-valid step beats rendering nothing with a broken footer.
  $effect(() => {
    if (!$onboardingComplete && stepIndex === -1) step = steps[steps.length - 1]
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
    step = 'watch'
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

  // Publish what Back means here for the app-wide controller translator. Without this it applies
  // its generic rule — history.back() anywhere but home — to a wizard that is itself standing in
  // for home, so B did nothing a user could see on a Deck's first launch.
  $effect(() => {
    if ($onboardingComplete) {
      onboardingNav.set(null)
      return
    }
    onboardingNav.set({
      introRunning,
      canGoBack: mode === 'wizard' && stepIndex > 0 && !busy,
      back: goBack,
    })
    return () => onboardingNav.set(null)
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

{#if !$onboardingComplete}
  <div bind:this={root} role="dialog" aria-modal="true" aria-labelledby="setup-title" tabindex="-1" data-nav-trap class:keyboard-open={keyboardOpen} class="onboarding-surface fixed inset-0 z-[160] flex h-[100dvh] w-screen flex-col overflow-hidden bg-background text-foreground" onkeydown={handleKeydown}>
    <span id="setup-progress" class="sr-only">{m.onboarding_step_count({ current: String(stepIndex + 1), total: String(totalSteps) })}</span>
    <div class="setup-stage min-h-0 flex-1">
      <aside class="setup-art-panel" aria-hidden="true">
        <SetupArtwork {intent} />
        <div class="art-wordmark"><Wordmark /></div>
      </aside>
      <main class="setup-main min-w-0">
        {#if mode === 'transfer'}
          <!-- Its own branch rather than a step: this screen is not "3 of 8" of anything, it is
               the alternative to the whole wizard, and it owns its own footer. -->
          <div class="setup-step">
            <section class="setup-content">
              <TransferStep oncancel={leaveTransfer} onfinished={completeTransfer} />
            </section>
          </div>
          <footer class="setup-actions flex items-center justify-between gap-3">
            <button type="button" data-focusable onclick={leaveTransfer} class="setup-button text-muted-foreground hover:bg-secondary">
              <ChevronLeft size={17} />{m.onboarding_transfer_manual()}
            </button>
          </footer>
        {:else}
        <div class="setup-step">
          {#key step}
          <section class="setup-content">
            {#if step === 'watch'}
              <WatchStep bind:intent />
            {:else if step === 'metadata'}
              <MetadataStep bind:movieMetadata />
            {:else if step === 'access'}
              <AccessStep bind:tmdbToken bind:ratingsKey onswitch={useStremioMetadata} />
            {:else if step === 'startup'}
              <StartupStep bind:startupLibrary {movieMetadata} />
            {:else if step === 'connect'}
              <ConnectStep bind:connections bind:busy />
            {:else if step === 'sync'}
              <SyncStep {connections} bind:nuvioExtras bind:busy bind:imported={syncImported} />
            {:else if step === 'sources'}
              <SourcesStep {intent} synced={syncImported} bind:busy />
            {:else if step === 'playback'}
              <PlaybackStep bind:busy />
            {:else}
              <ReadyStep {readiness} />
            {/if}
          </section>
          {/key}
        </div>
        <footer class="setup-actions flex items-center justify-between gap-3">
          {#if stepIndex === 0}<button type="button" data-focusable onclick={skip} class="setup-button text-muted-foreground hover:bg-secondary"><SkipForward size={17} />{m.onboarding_skip()}</button>
          {:else}<button type="button" data-focusable onclick={goBack} disabled={busy} class="setup-button hover:bg-secondary"><ChevronLeft size={17} />{m.onboarding_back()}</button>{/if}
          {#if step === 'ready'}
            <button type="button" data-focusable onclick={complete} class="setup-button bg-foreground text-background"><Check size={17} />{m.onboarding_ready_start()}</button>
          {:else}
            <div class="flex items-center gap-3">
              {#if step === 'watch'}
                <!-- Sits beside Next because it is the other way forward from this screen, not a
                     setting on it. Offered only here: mid-wizard it would discard answers already
                     given. -->
                <button type="button" data-focusable onclick={enterTransfer} class="setup-button text-muted-foreground hover:bg-secondary"><MonitorSmartphone size={17} />{m.onboarding_transfer_cta()}</button>
              {/if}
              {#if step === 'connect' || step === 'sources' || step === 'playback'}
                <button type="button" data-focusable onclick={goNext} disabled={busy} class="setup-button text-muted-foreground hover:bg-secondary">{m.onboarding_skip_step()}</button>
              {/if}
              <button type="button" data-focusable onclick={goNext} disabled={busy || blocked} class="setup-button bg-foreground text-background">{m.onboarding_next()}<ArrowRight size={17} /></button>
            </div>
          {/if}
        </footer>
        {/if}
      </main>
    </div>
    {#if introRunning}<IntroSequence oncomplete={() => (introRunning = false)} />{/if}
  </div>
{/if}

<style>
  .setup-stage { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); }
  .setup-art-panel { grid-column: 2; grid-row: 1; position: relative; overflow: hidden; background: #111216; }
  .art-wordmark { position: absolute; bottom: max(2.5rem, env(safe-area-inset-bottom)); right: max(2.5rem, env(safe-area-inset-right)); display: flex; color: white; }
  .setup-main { grid-column: 1; grid-row: 1; min-height: 0; display: flex; flex-direction: column; justify-content: safe center; padding: max(2.5rem, env(safe-area-inset-top)) clamp(1.5rem, 4.5vw, 5rem) max(2.5rem, env(safe-area-inset-bottom)); }
  .setup-step { min-height: 0; overflow-y: auto; overscroll-behavior: contain; width: 100%; max-width: 36rem; margin-inline: auto; padding: 4px; scroll-behavior: auto; }
  .setup-content { animation: step-enter 320ms cubic-bezier(.2, .7, .2, 1) both; }
  .setup-actions { flex-shrink: 0; width: 100%; max-width: 36rem; margin-inline: auto; margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid hsl(var(--border) / .65); }
  @keyframes step-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .onboarding-surface { height: var(--setup-viewport-height, 100dvh); top: var(--setup-viewport-top, 0px); width: 100%; }
    .setup-stage { position: relative; display: flex; }
    .setup-art-panel { position: absolute; inset: 0; pointer-events: none; }
    .setup-art-panel::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, hsl(var(--background) / .12), hsl(var(--background) / .94) 24%, hsl(var(--background)) 65%); }
    .art-wordmark { z-index: 1; top: max(1.5rem, env(safe-area-inset-top)); bottom: auto; left: max(1.5rem, env(safe-area-inset-left)); right: auto; }
    .setup-main { z-index: 1; width: 100%; justify-content: flex-start; padding: max(6rem, calc(env(safe-area-inset-top) + 4.5rem)) max(1.5rem, env(safe-area-inset-right)) 0 max(1.5rem, env(safe-area-inset-left)); }
    .setup-step { flex: 1; max-width: 34rem; padding: 4px 4px 1rem; }
    .setup-content :global(.text-sm) { font-size: 14px; }
    .setup-content :global(.text-xs) { font-size: 12px; }
    .setup-actions { max-width: 34rem; margin-top: 0; padding: 1rem 0 max(1rem, env(safe-area-inset-bottom)); background: hsl(var(--background)); }
    .setup-actions .setup-button { min-height: 48px; font-size: 14px; }
    /* Keep the forward action off the screen edge on a phone. The last child is the primary button
       on the final screen and the skip/next pair everywhere else, so this targets whichever it is. */
    .setup-actions > :last-child { max-width: 72%; }
    .keyboard-open .setup-main { padding-top: max(1rem, env(safe-area-inset-top)); }
    .keyboard-open .art-wordmark { display: none; }
    .keyboard-open .setup-art-panel::after { background: hsl(var(--background) / .97); }
  }
  @media (max-height: 600px) and (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .setup-actions { padding-top: .6rem; }
  }
  .setup-button { display: inline-flex; min-height: 2.75rem; align-items: center; justify-content: center; gap: .5rem; border-radius: .5rem; padding: .65rem 1rem; font-size: .85rem; font-weight: 600; transition: background 180ms, transform 180ms; }
  .setup-button:disabled { opacity: .5; cursor: wait; }
  .setup-button:active { transform: translateY(1px); }
  @media (prefers-reduced-motion: reduce) { .setup-button { transition: none; } .setup-content { animation: none; } }
</style>
