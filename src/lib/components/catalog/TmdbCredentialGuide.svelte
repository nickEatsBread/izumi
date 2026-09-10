<script lang="ts">
  import { onMount } from 'svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import KeyRound from '@lucide/svelte/icons/key-round'
  import X from '@lucide/svelte/icons/x'

  let { onClose, onUseKeyless }: { onClose: () => void; onUseKeyless: () => void } = $props()
  let dialog = $state<HTMLElement>()
  let openError = $state('')

  const apiSettingsUrl = 'https://www.themoviedb.org/settings/api'
  const guideUrl = 'https://duckkota.gitlab.io/guides/tmdb/'
  async function openGuide() {
    openError = ''
    try {
      await openUrl(guideUrl)
    } catch (cause) {
      openError = cause instanceof Error ? cause.message : 'Could not open the guide. Please visit duckkota.gitlab.io/guides/tmdb in your browser.'
    }
  }

  async function openTmdb() {
    openError = ''
    try {
      await openUrl(apiSettingsUrl)
    } catch (cause) {
      openError = cause instanceof Error ? cause.message : 'Could not open TMDB. Please open themoviedb.org/settings/api in your browser.'
    }
  }

  onMount(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    requestAnimationFrame(() => dialog?.querySelector<HTMLElement>('[data-focusable]')?.focus())
    return () => {
      if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus())
    }
  })
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') onClose() }} />

<div
  bind:this={dialog}
  role="dialog"
  aria-modal="true"
  aria-labelledby="tmdb-guide-title"
  aria-describedby="tmdb-guide-description"
  tabindex="-1"
  data-nav-trap
  class="fixed inset-0 z-[150] grid h-[100dvh] place-items-end overflow-hidden bg-black/75 sm:place-items-center sm:p-4"
  onclick={(event) => { if (event.target === event.currentTarget) onClose() }}
  onkeydown={(event) => { if (event.key === 'Escape') onClose() }}
>
  <section class="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
    <header class="flex shrink-0 items-start gap-4 border-b border-border px-5 py-5 sm:px-6">
      <span class="grid size-11 shrink-0 place-items-center rounded-full bg-theme/15 text-theme">
        <KeyRound size={22} aria-hidden="true" />
      </span>
      <div class="min-w-0 flex-1">
        <h2 id="tmdb-guide-title" class="text-xl font-black sm:text-2xl">Get your free TMDB token</h2>
        <p id="tmdb-guide-description" class="mt-1 text-sm text-muted-foreground">A free TMDB account is required. No payment details needed.</p>
      </div>
      <button
        type="button"
        data-focusable
        onclick={onClose}
        aria-label="Close TMDB token guide"
        class="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      ><X size={20} /></button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
      <p class="text-sm leading-6 text-muted-foreground">A free TMDB account is all you need. The guide below walks through creating the account and copying the long API Read Access Token — the one starting <code class="rounded bg-background/60 px-1 font-mono text-xs">eyJ</code>, not the short v3 API key. Paste it into the field behind this dialog; it is stored only on this device.</p>

      <button type="button" data-focusable onclick={() => void openGuide()} class="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-secondary px-4 text-sm font-black transition-colors hover:bg-accent">
        How do I get a token? <ExternalLink size={17} aria-hidden="true" />
      </button>

      {#if openError}
        <p class="mt-5 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{openError}</p>
      {/if}

      <section class="mt-6 rounded-xl border border-border bg-secondary/45 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div>
          <h3 class="text-sm font-black">Prefer not to create a TMDB token?</h3>
          <p class="mt-1 text-xs leading-5 text-muted-foreground">Switch to Cinemeta’s free IMDb-ID movie and TV catalog. It needs no API key, but does not include TMDB-specific discovery filters.</p>
        </div>
        <button type="button" data-focusable onclick={onUseKeyless} class="mt-3 min-h-10 shrink-0 rounded-lg bg-secondary px-4 text-sm font-black transition-colors hover:bg-accent sm:mt-0">Use keyless catalog</button>
      </section>
    </div>

    <footer class="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6">
      <button type="button" data-focusable onclick={onClose} class="min-h-10 rounded-lg px-3 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">Close</button>
      <button type="button" data-focusable onclick={() => void openTmdb()} class="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-black text-primary-foreground transition-opacity hover:opacity-90">
        Open TMDB <ExternalLink size={17} aria-hidden="true" />
      </button>
    </footer>
  </section>
</div>
