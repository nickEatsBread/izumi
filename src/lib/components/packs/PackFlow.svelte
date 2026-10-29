<script lang="ts">
  // Setting izumi up from a pack: izumi's own review screen (everything the pack adds, the licences
  // of any modules it downloads, its setup steps), then apply, the pack's startup animation, its
  // setup steps (a source's sign-in) and done. "Set up with …" is the consent to everything listed;
  // nothing is written before it. The surface is protected from theme stylesheets.
  import { onMount, tick } from 'svelte'
  import Package from '@lucide/svelte/icons/package'
  import Check from '@lucide/svelte/icons/check'
  import X from '@lucide/svelte/icons/x'
  import Spinner from '$lib/components/Spinner.svelte'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import Store from '@lucide/svelte/icons/store'
  import Palette from '@lucide/svelte/icons/palette'
  import Puzzle from '@lucide/svelte/icons/puzzle'
  import Download from '@lucide/svelte/icons/download'
  import Clapperboard from '@lucide/svelte/icons/clapperboard'
  import KeyRound from '@lucide/svelte/icons/key-round'
  import ExtensionServiceSettings from '$lib/components/settings/ExtensionServiceSettings.svelte'
  import { protectedSurface } from '$lib/themes/safe-mode'
  import { onPadButton } from '$lib/nav/pad-events'
  import { modulePercent, moduleProgressText, modules } from '$lib/modules/modules'
  import { playStartupAnimationAndWait } from '$lib/startup/animation'
  import { defaultPackDeps } from '$lib/packs/deps'
  import {
    applyPack,
    applySteps,
    loadPackPlan,
    PackLoadError,
    type ApplyStep,
    type PackPlan,
    type StepState,
  } from '$lib/packs/session'

  let { url, onfinish, oncancel }: {
    url: string
    /** Set up and every step done (or skipped). */
    onfinish: () => void
    /** The user chose not to set the pack up (nothing was written). */
    oncancel: () => void
  } = $props()

  type Phase = 'loading' | 'unreadable' | 'review' | 'applying' | 'failed' | 'steps' | 'done'
  let phase = $state<Phase>('loading')
  let plan = $state<PackPlan | null>(null)
  let loadErrors = $state<string[]>([])
  let progress = $state<Record<string, { state: StepState; detail?: string }>>({})
  let failure = $state('')
  let stepIndex = $state(0)
  let stepComplete = $state(false)
  let root = $state<HTMLElement>()

  const pack = $derived(plan?.pack)
  const steps = $derived(plan ? applySteps(plan) : [])
  const domain = $derived.by(() => { try { return new URL(url).hostname } catch { return url } })
  const sources = $derived(plan?.items.filter((i) => i.item.kind === 'source') ?? [])
  const themes = $derived(plan?.items.filter((i) => i.item.kind === 'theme') ?? [])
  const newStores = $derived(plan?.stores.filter((s) => !s.known) ?? [])
  const setupStep = $derived(plan && phase === 'steps' ? plan.pack.steps[stepIndex] : undefined)
  const stepSource = $derived.by(() => {
    const entry = plan?.items.find((i) => i.item.ref === setupStep?.item)?.entry
    return entry?.install.type === 'package' && entry.install.pkg.backend === 'izumi-service'
      ? { id: entry.install.pkg.id, name: entry.name }
      : null
  })
  const waitingModules = $derived(plan?.modules.filter((m) => m.needed).map((m) => $modules[m.id] ?? m).filter((m) => m.state !== 'ready') ?? [])

  function mb(bytes: number) {
    return `${Math.max(1, Math.round(bytes / 1_048_576))} MB`
  }

  async function focusPrimary() {
    await tick()
    const primary = root?.querySelector<HTMLElement>('[data-pack-primary]')
    primary?.focus({ preventScroll: true })
    // The page scrolls: a focused button below the fold must come into view.
    primary?.scrollIntoView({ block: 'nearest' })
  }

  async function load() {
    phase = 'loading'
    try {
      plan = await loadPackPlan(url, defaultPackDeps)
      phase = 'review'
    } catch (error) {
      loadErrors = error instanceof PackLoadError ? error.errors : [String(error)]
      phase = 'unreadable'
    }
    void focusPrimary()
  }

  async function setUp() {
    if (!plan || plan.errors.length || phase !== 'review' && phase !== 'failed') return
    phase = 'applying'
    progress = {}
    failure = ''
    try {
      await applyPack(plan, defaultPackDeps, (key, state, detail) => { progress = { ...progress, [key]: { state, detail } } })
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
      phase = 'failed'
      void focusPrimary()
      return
    }
    // CrunchyDeck order: the intro plays, then the sign-in.
    if (plan.pack.startup && progress.startup?.state === 'done') await playStartupAnimationAndWait()
    stepIndex = 0
    stepComplete = false
    phase = plan.pack.steps.length ? 'steps' : 'done'
    void focusPrimary()
  }

  function nextStep() {
    if (!plan) return
    stepComplete = false
    if (stepIndex + 1 < plan.pack.steps.length) stepIndex += 1
    else phase = 'done'
    void focusPrimary()
  }

  // A step whose source cannot show settings here (not a local service) is skipped.
  $effect(() => {
    if (phase === 'steps' && setupStep && !stepSource) nextStep()
  })

  function stepIcon(key: ApplyStep['key']) {
    return progress[key]?.state
  }

  onMount(() => {
    void load()
    return onPadButton((input) => {
      if (!input.pressed || input.name !== 'b') return
      if (phase === 'review' || phase === 'unreadable' || phase === 'failed') oncancel()
    })
  })
</script>

<div
  bind:this={root}
  use:protectedSurface
  role="dialog"
  aria-modal="true"
  aria-label={pack ? `Set up ${pack.name}` : 'Pack'}
  data-nav-trap
  data-pack-flow
  tabindex="-1"
  class="fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-background text-foreground"
  data-nav-scroll-container
>
  <div class="mx-auto flex min-h-full w-full max-w-2xl flex-col px-5 pb-10 pt-[max(2.5rem,env(safe-area-inset-top))] sm:px-8">
    {#if phase === 'loading'}
      <div class="grid flex-1 place-items-center">
        <p class="flex items-center gap-3 text-muted-foreground"><Spinner size="md" /> Reading the pack from {domain}…</p>
      </div>
    {:else if phase === 'unreadable'}
      <div class="flex flex-1 flex-col justify-center">
        <span class="grid size-12 place-items-center rounded-full bg-destructive/15 text-destructive"><TriangleAlert size={22} /></span>
        <h1 class="mt-4 text-2xl font-black">This pack can't be used</h1>
        <p class="mt-2 text-sm text-muted-foreground">From {domain}</p>
        <ul class="mt-4 space-y-1 text-sm text-destructive">
          {#each loadErrors as error, index (index)}<li>{error}</li>{/each}
        </ul>
        <div class="mt-8 flex gap-2">
          <button type="button" data-focusable data-pack-primary onclick={oncancel} class="h-11 rounded-xl bg-secondary px-5 text-sm font-bold">Close</button>
          <button type="button" data-focusable onclick={load} class="h-11 rounded-xl px-5 text-sm font-bold text-muted-foreground hover:bg-accent">Try again</button>
        </div>
      </div>
    {:else if pack && plan}
      <header>
        {#if pack.banner}
          <img src={pack.banner} alt="" class="mb-6 aspect-[3/1] w-full rounded-2xl object-cover" />
        {/if}
        <div class="flex items-center gap-4">
          {#if pack.icon}
            <img src={pack.icon} alt="" class="size-14 shrink-0 rounded-2xl object-cover" />
          {:else}
            <span class="grid size-14 shrink-0 place-items-center rounded-2xl bg-theme/15 text-theme"><Package size={26} /></span>
          {/if}
          <div class="min-w-0">
            <h1 class="truncate text-2xl font-black sm:text-3xl">{pack.name}</h1>
            <p class="truncate text-sm text-muted-foreground">
              {pack.author ? `By ${pack.author} · ` : ''}{domain} · version {pack.version}
            </p>
          </div>
        </div>
      </header>

      {#if phase === 'review' || phase === 'failed'}
        <p class="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Third-party pack. izumi hasn't reviewed it. Only set it up if you trust {domain}.
        </p>
        {#if pack.description}<p class="mt-4 text-sm text-muted-foreground">{pack.description}</p>{/if}

        <h2 class="mt-7 text-xs font-black uppercase tracking-wider text-muted-foreground">This pack will</h2>
        <ul class="mt-3 space-y-3">
          {#each newStores as store (store.url)}
            <li class="flex gap-3">
              <Store class="mt-0.5 shrink-0 text-theme" size={18} />
              <span class="text-sm"><span class="font-bold">Add the store {store.name}</span> <span class="text-muted-foreground">({store.domain}{store.signed ? ', signed' : ''}). Its sources and themes keep updating from there.</span></span>
            </li>
          {/each}
          {#each sources as planned (planned.item.ref)}
            <li class="flex gap-3">
              <Puzzle class="mt-0.5 shrink-0 text-theme" size={18} />
              <span class="text-sm"><span class="font-bold">Install the source {planned.entry?.name ?? planned.item.id}</span> <span class="text-muted-foreground">from {planned.storeName}{planned.entry?.install.type === 'package' && planned.entry.install.pkg.backend === 'izumi-service' ? ', a program that runs on this device' : ''}.{planned.item.screen ? ` Adds its own catalog as a screen${planned.item.screen === 'default' ? ' and opens izumi on it' : ''}.` : ''}</span></span>
            </li>
          {/each}
          {#each themes as planned (planned.item.ref)}
            <li class="flex gap-3">
              <Palette class="mt-0.5 shrink-0 text-theme" size={18} />
              <span class="text-sm"><span class="font-bold">Install the theme {planned.entry?.name ?? planned.item.id}</span>{#if planned.item.apply}{' '}<span class="text-muted-foreground">and use it.</span>{/if}</span>
            </li>
          {/each}
          {#each plan.modules as module (module.id)}
            <li class="flex gap-3">
              <Download class="mt-0.5 shrink-0 {module.needed ? 'text-theme' : 'text-muted-foreground'}" size={18} />
              {#if module.needed}
                <span class="text-sm">
                  <span class="font-bold">Download {module.publisher}'s {module.name} module</span>
                  <span class="text-muted-foreground">(about {mb(module.approxBytes)}) in the background. {module.purpose}.</span>
                  <span class="mt-1 block font-bold text-amber-100">Continuing accepts {module.licence}.</span>
                </span>
              {:else}
                <span class="text-sm text-muted-foreground">{module.name} is not needed on this device.</span>
              {/if}
            </li>
          {/each}
          {#if pack.startup}
            <li class="flex gap-3">
              <Clapperboard class="mt-0.5 shrink-0 text-theme" size={18} />
              <span class="text-sm"><span class="font-bold">Play a startup animation</span> <span class="text-muted-foreground">when izumi opens ({mb(pack.startup.bytes)}). Any button skips it; Settings, Appearance turns it off.</span></span>
            </li>
          {/if}
          {#each pack.steps as step, index (index)}
            <li class="flex gap-3">
              <KeyRound class="mt-0.5 shrink-0 text-theme" size={18} />
              <span class="text-sm"><span class="font-bold">Then ask you to {step.title ? step.title[0].toLowerCase() + step.title.slice(1) : `set up ${plan.items.find((i) => i.item.ref === step.item)?.entry?.name ?? 'a source'}`}.</span></span>
            </li>
          {/each}
        </ul>

        {#if plan.errors.length}
          <div role="alert" class="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <p class="font-bold">This pack can't be set up:</p>
            <ul class="mt-1 list-disc space-y-1 pl-5">{#each plan.errors as error, index (index)}<li>{error}</li>{/each}</ul>
          </div>
        {/if}
        {#if phase === 'failed'}
          <div role="alert" class="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Setup stopped and nothing was kept: {failure}
          </div>
        {/if}

        <div class="mt-auto flex flex-col-reverse gap-2 pt-8 sm:flex-row sm:justify-end">
          <button type="button" data-focusable onclick={oncancel} class="h-12 rounded-xl px-5 text-sm font-bold text-muted-foreground hover:bg-accent">Not now</button>
          <button type="button" data-focusable data-pack-primary disabled={plan.errors.length > 0} onclick={setUp} class="h-12 rounded-xl bg-theme px-6 text-sm font-black text-white disabled:opacity-50">
            {phase === 'failed' ? 'Try again' : `Set up with ${pack.name}`}
          </button>
        </div>
      {:else if phase === 'applying'}
        <h2 class="mt-8 text-lg font-black">Setting up…</h2>
        <ul class="mt-4 space-y-2.5" aria-live="polite">
          {#each steps as step (step.key)}
            {@const state = stepIcon(step.key)}
            <li class="flex items-center gap-3 text-sm">
              {#if state === 'done'}<Check class="text-emerald-400" size={18} />
              {:else if state === 'failed'}<X class="text-destructive" size={18} />
              {:else if state === 'working'}<Spinner class="mx-px" />
              {:else}<span class="size-[18px] rounded-full border border-border"></span>{/if}
              <span class:text-muted-foreground={!state}>{step.label}</span>
              {#if progress[step.key]?.detail}<span class="text-xs text-muted-foreground">{progress[step.key]?.detail}</span>{/if}
            </li>
          {/each}
        </ul>
      {:else if phase === 'steps' && setupStep && stepSource}
        <h2 class="mt-8 text-2xl font-black">{setupStep.title ?? `Set up ${stepSource.name}`}</h2>
        {#if plan.pack.steps.length > 1}<p class="mt-1 text-xs text-muted-foreground">Step {stepIndex + 1} of {plan.pack.steps.length}</p>{/if}
        <div class="mt-5 rounded-2xl border border-border bg-card p-5">
          {#key stepIndex}
            <ExtensionServiceSettings inline id={stepSource.id} name={stepSource.name} oncomplete={(complete) => (stepComplete = complete)} />
          {/key}
        </div>
        <div class="mt-auto flex justify-end gap-2 pt-8">
          <button type="button" data-focusable data-pack-primary={stepComplete ? true : undefined} onclick={nextStep} class="h-12 rounded-xl px-6 text-sm font-black {stepComplete ? 'bg-theme text-white' : 'bg-secondary text-secondary-foreground'}">
            {stepComplete ? 'Continue' : 'Skip for now'}
          </button>
        </div>
      {:else if phase === 'done'}
        <div class="flex flex-1 flex-col justify-center">
          <span class="grid size-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-400"><Check size={24} /></span>
          <h2 class="mt-4 text-3xl font-black">{pack.name} is ready</h2>
          {#each waitingModules as module (module.id)}
            <div class="mt-5 rounded-xl border border-border bg-card px-4 py-3">
              <p class="text-sm font-bold">{module.name} is still downloading</p>
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full bg-theme transition-[width]" style:width="{modulePercent(module)}%"></div></div>
              <p class="mt-1.5 text-xs text-muted-foreground">{moduleProgressText(module)}. Protected videos play as soon as it's done.</p>
            </div>
          {/each}
          <div class="mt-8">
            <button type="button" data-focusable data-pack-primary onclick={onfinish} class="h-12 rounded-xl bg-theme px-6 text-sm font-black text-white">Start watching</button>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
