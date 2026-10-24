<script lang="ts">
  import { env as publicEnv } from '$env/dynamic/public'
  import Wordmark from '$lib/components/Wordmark.svelte'
  import IntroSequence, { introAlreadyPlayed } from './IntroSequence.svelte'
  import SetupArtwork from './SetupArtwork.svelte'
  import StartStep from './steps/StartStep.svelte'
  import WatchStep from './steps/WatchStep.svelte'
  import ConnectStep from './steps/ConnectStep.svelte'
  import SourcesStep from './steps/SourcesStep.svelte'
  import TransferStep from './steps/TransferStep.svelte'
  import { gameMode, gameModeResolved, onboardingNav } from '$lib/player/session'
  import ReadyStep from './steps/ReadyStep.svelte'
  import { goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import Check from '@lucide/svelte/icons/check'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import SkipForward from '@lucide/svelte/icons/skip-forward'
  import { m } from '$lib/paraglide/messages.js'
  import { idleConnectStates, type ConnectStates } from '$lib/onboarding/connect-state'
  import type { SetupReadiness } from '$lib/onboarding/readiness'
  import { defaultPlaybackLanguages } from '$lib/onboarding/playback-languages'
  import type { NuvioExtras } from '$lib/onboarding/sync-receipt'
  import {
    catalogDefaultProvider,
    catalogLastScreen,
    catalogProviders,
    resolveCatalogScreenStartup,
    selectCatalogScreen,
    tmdbReadToken,
  } from '$lib/settings/catalog'
  import {
    finishOnboarding,
    onboardingCatalogPlan,
    onboardingMovieMetadata,
    onboardingStartupLibrary,
    onboardingSteps,
    onboardingComplete,
    type OnboardingIntent,
    type OnboardingPath,
    type StepId,
  } from '$lib/settings/onboarding'
  import { debridKey, extensionUrls, preferredAudioLang, preferredSubLang, torrentPlaybackMode, type AudioLang, type SubLang } from '$lib/settings/ui'
  import { addonUrls, CINEMETA_BASE, disabledSources, normalizeBase, replaceAddonBase } from '$lib/stremio/sources'

  const initialProvider = get(catalogDefaultProvider)
  const initialProviders = get(catalogProviders)
  const initialBoth = initialProvider === 'merged' || (initialProviders.includes('auto') && initialProviders.some(provider => provider === 'tmdb' || provider === 'stremio'))
  // Setup never asks for an API key. TMDB is used when a token is already there (saved on an
  // earlier run, or built into a private build), and the keyless catalog otherwise.
  const movieMetadata = onboardingMovieMetadata(Boolean(get(tmdbReadToken).trim() || (publicEnv as Record<string, string | undefined>).PUBLIC_TMDB_READ_TOKEN?.trim()))
  // Not asked either; Settings → Catalog changes it.
  const startupLibrary = onboardingStartupLibrary(initialProvider, initialBoth)

  let root = $state<HTMLElement>()
  // Only a brand-new install ever reaches this component, so the ident needs no flag of its own —
  // "setup has not finished" is already the definition of a new user.
  let introRunning = $state(!introAlreadyPlayed())
  // Game mode means a Steam Deck, where typing keys and passwords on a touch keyboard is the worst
  // version of this flow. There, setting up from a device that is already configured is the
  // default answer, and the wizard is the escape hatch rather than the reverse.
  let mode = $state<'wizard' | 'transfer'>('wizard')
  let modeSettled = false
  let path = $state<OnboardingPath>('new')
  let step = $state<StepId>('start')
  let busy = $state(false)
  let keyboardOpen = $state(false)
  let sourcesStep = $state<ReturnType<typeof SourcesStep>>()
  /** Setup steps aside while the user browses the real Store. It stays mounted, only hidden, so
   *  "Back to setup" returns to the same step with every answer intact. */
  let browsing = $state(false)

  let intent = $state<OnboardingIntent>({
    anime: initialBoth || !(initialProvider === 'tmdb' || initialProvider === 'stremio'),
    films: initialBoth || initialProvider === 'tmdb' || initialProvider === 'stremio',
  })
  let connections = $state<ConnectStates>(idleConnectStates())
  let nuvioExtras = $state<NuvioExtras>({ library: false, progress: false, history: false })
  let imported = $state(false)

  // Cinemeta (added for film users) only supplies metadata, so it does not count as a way to play.
  const sourceReady = $derived($addonUrls.some((url) => normalizeBase(url) !== normalizeBase(CINEMETA_BASE)) || $extensionUrls.length > 0)
  const steps = $derived(onboardingSteps(path))
  const stepIndex = $derived(steps.indexOf(step))
  const totalSteps = $derived(steps.length)
  /** Nothing chosen means nothing to set up, so the watch screen holds the flow until one is. */
  const blocked = $derived(step === 'watch' && !intent.anime && !intent.films)
  // About torrents only: an extension source plays without either, but this row says what a
  // torrent would do, now that the question is always asked.
  const playbackReady = $derived($torrentPlaybackMode === 'direct' || Boolean($debridKey.trim()))
  const readiness = $derived<SetupReadiness>({ sources: sourceReady, playback: playbackReady })

  function enterTransfer() {
    modeSettled = true
    mode = 'transfer'
  }

  function leaveTransfer() {
    modeSettled = true
    mode = 'wizard'
    step = 'start'
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

  /** The start screen's cards are the way forward themselves, so choosing one also moves on. */
  async function browseStore() {
    browsing = true
    await goto('/app/settings/store')
  }

  function choosePath(next: OnboardingPath) {
    path = next
    step = 'watch'
  }

  function goBack() {
    if (!busy && stepIndex > 0) step = steps[stepIndex - 1]
  }

  async function goNext() {
    if (busy || blocked || stepIndex >= steps.length - 1) return
    // Ticked sources install from here rather than from a button of their own. A failed install
    // keeps the user on the screen with its error showing; "Skip this step" still moves on.
    if (step === 'sources' && sourcesStep && !(await sourcesStep.install())) return
    step = steps[steps.indexOf(step) + 1]
  }

  function skipStep() {
    if (!busy && stepIndex < steps.length - 1) step = steps[stepIndex + 1]
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (mode === 'transfer') leaveTransfer()
      else goBack()
      return
    }
    if (event.key !== 'Tab' || !root) return
    // :disabled rather than [disabled]: controls inside a disabled fieldset (the source picker while
    // installing) carry no attribute of their own but still cannot take focus.
    const focusable = [...root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [href], [tabindex]:not([tabindex="-1"])',
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

  $effect(() => {
    if ($onboardingComplete || browsing) return
    step; mode
    const frame = requestAnimationFrame(() => {
      root?.querySelector('.setup-step')?.scrollTo({ top: 0 })
      root?.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  })

  $effect(() => {
    if ($onboardingComplete) return
    step = 'start'
    const previousFocus = document.activeElement as HTMLElement | null
    return () => previousFocus?.focus({ preventScroll: true })
  })

  // The page under setup must not scroll, except while setup has stepped aside for the Store. Kept
  // apart from the effect above so resuming never re-runs its reset to the start screen.
  $effect(() => {
    if ($onboardingComplete || browsing) return
    const htmlOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = htmlOverflow
      document.body.style.overflow = bodyOverflow
    }
  })

  // Publish what Back means here for the app-wide controller translator. Without this it applies
  // its generic rule — history.back() anywhere but home — to a wizard that is itself standing in
  // for home, so B did nothing a user could see on a Deck's first launch. From the transfer screen,
  // Back returns to the start screen, where the transfer card is.
  $effect(() => {
    // While browsing the Store, Back belongs to the Store; setup returns through its own bar.
    if ($onboardingComplete || browsing) {
      onboardingNav.set(null)
      return
    }
    onboardingNav.set({
      introRunning,
      canGoBack: mode === 'transfer' || (stepIndex > 0 && !busy),
      back: () => (mode === 'transfer' ? leaveTransfer() : goBack()),
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
  <div bind:this={root} role="dialog" aria-modal="true" aria-labelledby="setup-title" tabindex="-1" data-nav-trap={browsing ? undefined : ''} class:keyboard-open={keyboardOpen} class:setup-away={browsing} class="onboarding-surface fixed inset-0 z-[160] flex h-[100dvh] w-screen flex-col overflow-hidden bg-background text-foreground" onkeydown={handleKeydown}>
    <span id="setup-progress" class="sr-only">{m.onboarding_step_count({ current: String(stepIndex + 1), total: String(totalSteps) })}</span>
    <div class="setup-art" aria-hidden="true"><SetupArtwork {intent} /></div>
    <!-- Signs the screen from its corner, outside the sheet, where the old art panel carried it. -->
    <div class="setup-wordmark"><Wordmark /></div>
    <main class="setup-main min-w-0 flex-1">
      <!-- Every word on screen sits on this solid sheet; the posters stay behind it, never under text.
           Its width follows the content: the welcome is a short read, the sources screen is landscape. -->
      <div class="setup-sheet" class:narrow={mode === 'wizard' && step === 'start'} class:wide={mode === 'wizard' && (step === 'connect' || step === 'sources')}>
      {#if mode === 'transfer'}
        <!-- Its own branch rather than a step: this screen is not "2 of 4" of anything, it is
             the alternative to the whole wizard, and it owns its own footer. -->
        <div class="setup-step">
          <section class="setup-content max-w-2xl">
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
        <!-- No Svelte transitions on this block: a step clears the shell's busy flag when it is
             destroyed, which must happen before the next step mounts and sets its own. -->
        {#key step}
        <section class="setup-content">
          {#if step === 'start'}
            <StartStep onnew={() => choosePath('new')} onimport={() => choosePath('import')} ontransfer={enterTransfer} />
          {:else if step === 'watch'}
            <WatchStep bind:intent />
          {:else if step === 'connect'}
            <ConnectStep bind:connections bind:nuvioExtras bind:imported bind:busy />
          {:else if step === 'sources'}
            <SourcesStep bind:this={sourcesStep} synced={imported} bind:busy onbrowse={() => void browseStore()} />
          {:else}
            <ReadyStep {readiness} bind:connections trackers={intent.anime} tmdbTip={intent.films && movieMetadata === 'stremio'} />
          {/if}
        </section>
        {/key}
      </div>
      <footer class="setup-actions flex items-center justify-between gap-3">
        {#if stepIndex === 0}<button type="button" data-focusable onclick={skip} class="setup-button text-muted-foreground hover:bg-secondary"><SkipForward size={17} />{m.onboarding_skip()}</button>
        {:else}<button type="button" data-focusable onclick={goBack} disabled={busy} class="setup-button hover:bg-secondary"><ChevronLeft size={17} />{m.onboarding_back()}</button>{/if}
        {#if step === 'ready'}
          <button type="button" data-focusable onclick={complete} class="setup-button bg-foreground text-background"><Check size={17} />{m.onboarding_ready_start()}</button>
        {:else if step !== 'start'}
          <!-- The start screen has no Next: each of its cards is the way forward. -->
          <div class="flex items-center gap-3">
            {#if step === 'connect' || step === 'sources'}
              <button type="button" data-focusable onclick={skipStep} disabled={busy} class="setup-button text-muted-foreground hover:bg-secondary">{m.onboarding_skip_step()}</button>
            {/if}
            <button type="button" data-focusable onclick={() => void goNext()} disabled={busy || blocked} class="setup-button bg-foreground text-background">{m.onboarding_next()}<ArrowRight size={17} /></button>
          </div>
        {/if}
      </footer>
      {/if}
      </div>
    </main>
    {#if introRunning}<IntroSequence oncomplete={() => (introRunning = false)} />{/if}
  </div>
  {#if browsing}
    <div class="fixed bottom-6 left-1/2 z-[170] -translate-x-1/2">
      <button type="button" data-focusable onclick={() => (browsing = false)} class="setup-button bg-foreground text-background shadow-xl"><ChevronLeft size={17} />{m.onboarding_back_to_setup()}</button>
    </div>
  {/if}
{/if}

<style>
  .setup-art { position: absolute; inset: 0; pointer-events: none; }
  /* Dimmed evenly: with every word on the sheet, the wall is only backdrop. */
  .setup-art::after { content: ''; position: absolute; inset: 0; background: hsl(var(--background) / .65); }
  .setup-main { position: relative; z-index: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: safe center; padding: max(2rem, env(safe-area-inset-top)) clamp(1rem, 4vw, 3rem) max(2rem, env(safe-area-inset-bottom)); }
  .setup-sheet { display: flex; flex-direction: column; min-height: 0; max-height: 100%; width: 100%; max-width: 52rem; padding: 1.75rem 2.25rem 1.25rem; border: 1px solid hsl(var(--border)); border-radius: 1.25rem; background: hsl(var(--background) / .97); box-shadow: 0 24px 80px rgb(0 0 0 / .45); }
  .setup-sheet.narrow { max-width: 40rem; }
  .setup-sheet.wide { max-width: 64rem; }
  /* Below the sheet in paint order, so on a narrow window the sheet covers it rather than the reverse. */
  .setup-wordmark { position: absolute; right: max(2rem, env(safe-area-inset-right)); bottom: max(1.75rem, env(safe-area-inset-bottom)); display: flex; }
  .setup-away { display: none !important; }
  .setup-step { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px; scroll-behavior: auto; }
  .setup-content { animation: step-enter 320ms cubic-bezier(.2, .7, .2, 1) both; }
  .setup-actions { flex-shrink: 0; margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid hsl(var(--border) / .65); }
  @keyframes step-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  /* A docked Deck or a small laptop: tighter margins give the step its height back. */
  @media (max-height: 760px) {
    .setup-main { padding-block: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-bottom)); }
    .setup-sheet { padding-top: 1.25rem; }
    .setup-actions { margin-top: 1rem; padding-top: 1rem; }
  }
  @media (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .onboarding-surface { height: var(--setup-viewport-height, 100dvh); top: var(--setup-viewport-top, 0px); width: 100%; }
    /* A bottom sheet: a strip of posters stays visible above it. */
    .setup-main { justify-content: flex-end; padding: max(3.5rem, calc(env(safe-area-inset-top) + 2.5rem)) 0 0; }
    .setup-sheet { flex: 1; max-width: none; padding: 1.25rem max(1.25rem, env(safe-area-inset-right)) 0 max(1.25rem, env(safe-area-inset-left)); border-width: 1px 0 0; border-radius: 1.25rem 1.25rem 0 0; background: hsl(var(--background)); box-shadow: none; }
    /* The bottom sheet covers the corner, so the mark moves into the poster strip above it. */
    .setup-wordmark { top: max(1rem, env(safe-area-inset-top)); bottom: auto; left: max(1.25rem, env(safe-area-inset-left)); right: auto; }
    .setup-step { flex: 1; padding: 4px 4px 1rem; }
    .setup-content :global(.text-sm) { font-size: 14px; }
    .setup-content :global(.text-xs) { font-size: 12px; }
    .setup-actions { margin-top: 0; padding: 1rem 0 max(1rem, env(safe-area-inset-bottom)); background: hsl(var(--background)); }
    .setup-actions .setup-button { min-height: 48px; font-size: 14px; }
    /* Keep the forward action off the screen edge on a phone. The last child is the primary button
       on the final screen and the skip/next pair everywhere else, so this targets whichever it is. */
    .setup-actions > :last-child { max-width: 72%; }
    .keyboard-open .setup-main { padding-top: max(.5rem, env(safe-area-inset-top)); }
    .keyboard-open .setup-wordmark { display: none; }
  }
  @media (max-height: 600px) and (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .setup-actions { padding-top: .6rem; }
  }
  .setup-button { display: inline-flex; min-height: 2.75rem; align-items: center; justify-content: center; gap: .5rem; border-radius: .5rem; padding: .65rem 1rem; font-size: .85rem; font-weight: 600; transition: background 180ms, transform 180ms; }
  .setup-button:disabled { opacity: .5; cursor: wait; }
  .setup-button:active { transform: translateY(1px); }
  @media (prefers-reduced-motion: reduce) { .setup-button { transition: none; } .setup-content { animation: none; } }
</style>
