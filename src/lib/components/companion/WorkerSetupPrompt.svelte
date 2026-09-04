<script lang="ts">
  import { goto } from '$app/navigation'
  import Cloud from '@lucide/svelte/icons/cloud'
  import Clock3 from '@lucide/svelte/icons/clock-3'
  import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone'
  import ShieldCheck from '@lucide/svelte/icons/shield-check'
  import {
    companionWorkerSetupPrompt,
    respondToCompanionWorkerSetup,
    type CompanionWorkerSetupPrompt,
  } from '$lib/companion/client'
  import { setSyncProvider } from '$lib/sync/client'

  let busy = $state(false)
  let primary = $state<HTMLButtonElement>()

  $effect(() => {
    if ($companionWorkerSetupPrompt && !busy) setTimeout(() => primary?.focus(), 0)
  })

  function dismiss(prompt: CompanionWorkerSetupPrompt): void {
    if (busy) return
    respondToCompanionWorkerSetup(prompt, 'dismissed')
  }

  async function start(prompt: CompanionWorkerSetupPrompt): Promise<void> {
    if (busy) return
    busy = true
    try {
      await setSyncProvider('cloudflare')
      respondToCompanionWorkerSetup(prompt, 'starting')
      await goto('/app/settings/sync?from=tv&setup=worker')
    } catch (error) {
      busy = false
      respondToCompanionWorkerSetup(prompt, 'error', error instanceof Error ? error.message : 'Setup could not open')
    }
  }
</script>

{#if $companionWorkerSetupPrompt}
  {@const prompt = $companionWorkerSetupPrompt}
  <div
    class="fixed inset-0 z-[90] grid place-items-center bg-black/75 p-5 backdrop-blur-md"
    role="presentation"
    onkeydown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismiss(prompt)
      }
    }}
  >
    <div
      class="w-full max-w-2xl overflow-hidden rounded-[2rem] border border-white/15 bg-neutral-950 text-white shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="worker-setup-title"
      data-nav-trap
    >
      <div class="border-b border-white/10 px-7 py-6 sm:px-9">
        <div class="mb-5 flex items-center gap-3 text-sm font-semibold text-white/60">
          <span class="grid size-9 place-items-center rounded-xl bg-white text-black"><MonitorSmartphone size={18} /></span>
          Requested by {prompt.deviceName}
        </div>
        <h2 id="worker-setup-title" class="max-w-xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Let this TV play without keeping izumi open
        </h2>
        <p class="mt-4 max-w-xl text-base leading-relaxed text-white/65 sm:text-lg">
          Your TV opened this screen. A one-time Cloudflare Worker setup gives it a private route to the parts of izumi it needs.
        </p>
      </div>

      <div class="space-y-5 px-7 py-6 sm:px-9">
        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <ShieldCheck class="mb-3 text-white/80" size={22} />
            <p class="font-semibold">Private sync</p>
            <p class="mt-1 text-sm leading-relaxed text-white/55">Keep watch progress available across your izumi devices.</p>
          </div>
          <div>
            <Cloud class="mb-3 text-white/80" size={22} />
            <p class="font-semibold">More sources</p>
            <p class="mt-1 text-sm leading-relaxed text-white/55">Resolve most compatible add-on and debrid sources through your Worker.</p>
          </div>
          <div>
            <MonitorSmartphone class="mb-3 text-white/80" size={22} />
            <p class="font-semibold">Independent TV</p>
            <p class="mt-1 text-sm leading-relaxed text-white/55">Start supported playback even after this linked device is closed.</p>
          </div>
        </div>

        <div class="flex items-center gap-3 border-l-2 border-white/30 pl-4 text-white/65">
          <Clock3 class="shrink-0" size={19} />
          <p>This takes approximately 10 minutes. Some device-only and P2P sources will still require izumi to be open.</p>
        </div>
      </div>

      <div class="flex justify-end gap-3 border-t border-white/10 px-7 py-5 sm:px-9">
        <button type="button" data-focusable class="rounded-full px-5 py-3 font-semibold text-white/65 hover:text-white" onclick={() => dismiss(prompt)} disabled={busy}>
          Not now
        </button>
        <button bind:this={primary} type="button" data-focusable class="rounded-full bg-white px-6 py-3 font-bold text-black transition hover:bg-white/85 disabled:opacity-60" onclick={() => start(prompt)} disabled={busy}>
          {busy ? 'Opening setup…' : 'Start setup'}
        </button>
      </div>
    </div>
  </div>
{/if}
