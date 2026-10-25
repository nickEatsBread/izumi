<script lang="ts">
  // Shown when playback needs a module that is still downloading in the background (a pack asked for
  // it, so its licence was already accepted). Playback starts by itself once the module is ready.
  import { onMount, tick } from 'svelte'
  import Download from '@lucide/svelte/icons/download'
  import { listenSafe } from '$lib/util/listen'
  import { modulePercent, moduleProgressText, modules, retryModules } from '$lib/modules/modules'

  let { id, onclose }: { id: string; onclose: () => void } = $props()

  let root = $state<HTMLElement>()
  const status = $derived($modules[id])
  const failed = $derived(status?.state === 'failed')
  const percent = $derived(status ? modulePercent(status) : 0)

  async function focusPrimary() {
    await tick()
    root?.querySelector<HTMLElement>('[data-module-primary]')?.focus({ preventScroll: true })
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose(); return }
    if (e.key.length === 1 || e.key.startsWith('Arrow')) e.stopPropagation()
  }

  $effect(() => {
    if (failed) void focusPrimary()
  })

  onMount(() => {
    void focusPrimary()
    const offPad = listenSafe<{ name: string; pressed: boolean }>('gamepad-input', ({ payload }) => {
      if (!payload.pressed) return
      if (payload.name === 'b') onclose()
      else if (payload.name === 'a') {
        const focused = document.activeElement as HTMLElement | null
        if (focused && root?.contains(focused) && focused.tagName === 'BUTTON') focused.click()
      } else if (['up', 'down', 'left', 'right'].includes(payload.name)) {
        const buttons = [...(root?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])]
        const at = buttons.indexOf(document.activeElement as HTMLElement)
        const delta = payload.name === 'up' || payload.name === 'left' ? -1 : 1
        buttons[(at + delta + buttons.length) % buttons.length]?.focus({ preventScroll: true })
      }
    })
    return offPad
  })
</script>

<div
  bind:this={root}
  role="dialog"
  aria-modal="true"
  aria-label="Getting protected video ready"
  data-nav-trap
  data-module-wait
  tabindex="-1"
  class="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
  onkeydown={onKey}
  onclick={(e) => e.stopPropagation()}
>
  <div class="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 text-white shadow-2xl">
    <div class="p-5 sm:p-6">
      <div class="flex items-center gap-3">
        <span class="grid size-10 shrink-0 place-items-center rounded-full bg-theme/20 text-theme"><Download size={20} /></span>
        <h2 class="text-lg font-black leading-tight">Getting protected video ready</h2>
      </div>
      <p class="mt-3 text-sm text-white/75">
        {status?.name ?? 'A module'} is still downloading. Playback starts as soon as it's done.
      </p>
      <div class="mt-4 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div class="h-full rounded-full transition-[width] duration-200 {failed ? 'bg-amber-500' : 'bg-theme'}" style:width="{percent}%"></div>
      </div>
      <p class="mt-2 text-xs tabular-nums {failed ? 'text-amber-400' : 'text-white/50'}">
        {status ? moduleProgressText(status) : 'Starting download…'}
      </p>
      <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" data-focusable data-module-primary={failed ? undefined : true} onclick={onclose} class="h-11 rounded-xl px-4 text-sm font-bold text-white/70 hover:bg-white/10">
          Close
        </button>
        {#if failed}
          <button type="button" data-focusable data-module-primary onclick={() => void retryModules()} class="h-11 rounded-xl bg-theme px-5 text-sm font-black text-white">
            Try again
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>
