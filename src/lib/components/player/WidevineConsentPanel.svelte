<script lang="ts">
  // The protected-video consent card. Google's Widevine module may be downloaded but is never bundled.
  // The user agrees, then reads the module's own LICENSE (shipped inside Google's package) before it is
  // installed and loaded. When a browser on the device already ships the module (localCopy), that copy
  // is used and nothing is downloaded, but the licence is still shown and must still be accepted.
  //
  // Hosts own the overlay and how it closes: WidevineConsent (the player's first protected stream on
  // Linux, purpose 'play') and the Settings "Set up" dialog (any platform that saves through the
  // module, purpose 'setup').
  import { onMount, tick } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import ShieldCheck from '@lucide/svelte/icons/shield-check'
  import { listenSafe } from '$lib/util/listen'

  let { onaccepted, ondeclined, purpose = 'play', localCopy = null }: {
    onaccepted: (version: string) => void
    ondeclined: () => void
    purpose?: 'play' | 'setup'
    /** A browser's module version already on this device: set up from it, no download. */
    localCopy?: string | null
  } = $props()

  type Step = 'ask' | 'downloading' | 'license' | 'installing' | 'error'
  let step = $state<Step>('ask')
  let received = $state(0)
  let total = $state(0)
  let version = $state('')
  let license = $state('')
  let error = $state('')
  let root = $state<HTMLElement>()

  const percent = $derived(total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0)

  async function focusPrimary() {
    await tick()
    root?.querySelector<HTMLElement>('[data-consent-primary]')?.focus({ preventScroll: true })
  }

  async function download() {
    step = 'downloading'
    received = 0
    total = 0
    try {
      const staged = await invoke<{ version: string; license: string }>('widevine_download')
      version = staged.version
      license = staged.license
      step = 'license'
    } catch (e) {
      error = String(e)
      step = 'error'
    }
    void focusPrimary()
  }

  async function accept() {
    step = 'installing'
    try {
      const installed = await invoke<string>('widevine_accept', { version })
      onaccepted(installed)
    } catch (e) {
      error = String(e)
      step = 'error'
      void focusPrimary()
    }
  }

  onMount(() => {
    void focusPrimary()
    return listenSafe<{ received: number; total: number }>('widevine-download-progress', ({ payload }) => {
      received = payload.received
      total = payload.total
    })
  })
</script>

<div bind:this={root} class="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 text-white shadow-2xl">
  <div class="p-5 sm:p-6">
    <div class="flex items-center gap-3">
      <span class="grid size-10 shrink-0 place-items-center rounded-full bg-theme/20 text-theme"><ShieldCheck size={20} /></span>
      <h2 class="text-lg font-black leading-tight">Protected video</h2>
    </div>

    {#if step === 'ask'}
      <p class="mt-3 text-sm text-white/75">
        {#if purpose === 'play'}This video is encrypted. To play it, izumi needs Google's Widevine module, the same one browsers use.
        {:else}To download protected episodes for offline viewing, izumi needs Google's Widevine module, the same one browsers use.{/if}
        {#if localCopy}A copy (version {localCopy}) is already on this device from your browser, so nothing is downloaded.
        {:else}izumi downloads it from Google (about 22 MB) and keeps it on this device.{/if}
      </p>
      <p class="mt-2 text-xs text-white/50">You can remove it later in Settings, Playback, Advanced.</p>
    {:else if step === 'downloading'}
      <p class="mt-3 text-sm text-white/75">{localCopy ? 'Checking the copy on this device…' : 'Downloading from Google…'}</p>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div class="h-full rounded-full bg-theme transition-[width] duration-200" style:width="{percent}%"></div>
      </div>
      <p class="mt-2 text-xs tabular-nums text-white/50">{total ? `${(received / 1048576).toFixed(1)} of ${(total / 1048576).toFixed(1)} MB` : 'Asking Google for the current version…'}</p>
    {:else if step === 'license' || step === 'installing'}
      <p class="mt-3 text-sm text-white/75">Google's licence for the Widevine module {version}. Accept it to {purpose === 'play' ? 'install the module and play' : 'use the module for protected downloads'}.</p>
      <pre class="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-white/5 p-3 text-xs leading-relaxed text-white/70">{license}</pre>
    {:else if step === 'error'}
      <p class="mt-3 text-sm text-amber-400">The module could not be set up: {error}</p>
    {/if}

    <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" data-focusable onclick={ondeclined} class="h-11 rounded-xl px-4 text-sm font-bold text-white/70 hover:bg-white/10">
        {step === 'license' ? 'Decline' : 'Not now'}
      </button>
      {#if step === 'ask' || step === 'error'}
        <button type="button" data-focusable data-consent-primary onclick={download} class="h-11 rounded-xl bg-theme px-5 text-sm font-black text-white">
          {step === 'error' ? 'Try again' : localCopy ? 'Continue' : 'Download'}
        </button>
      {:else if step === 'license' || step === 'installing'}
        <button type="button" data-focusable data-consent-primary disabled={step === 'installing'} onclick={accept} class="h-11 rounded-xl bg-theme px-5 text-sm font-black text-white disabled:opacity-60">
          {step === 'installing' ? 'Installing…' : purpose === 'play' ? 'Accept and play' : 'Accept'}
        </button>
      {/if}
    </div>
  </div>
</div>
