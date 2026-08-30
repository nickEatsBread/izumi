<script lang="ts">
  import { onDestroy } from 'svelte'
  import Play from '@lucide/svelte/icons/play'
  import X from '@lucide/svelte/icons/x'
  import { upNextPrompt } from '$lib/player/session'
  import { playing } from '$lib/player/session'
  import { androidMpvActive } from '$lib/player/android-mpv'
  import { m } from '$lib/paraglide/messages.js'

  let remaining = $state(0)
  let activePrompt = $state<typeof $upNextPrompt>(null)
  let timer: ReturnType<typeof setInterval> | undefined

  function clearTimer() {
    clearInterval(timer)
    timer = undefined
  }

  $effect(() => {
    const prompt = $upNextPrompt
    if (!prompt || prompt === activePrompt) return
    activePrompt = prompt
    remaining = prompt.seconds
    clearTimer()
    timer = setInterval(() => {
      if ($upNextPrompt !== prompt) { clearTimer(); return }
      remaining -= 1
      if (remaining <= 0) { clearTimer(); prompt.play() }
    }, 1000)
  })

  $effect(() => {
    if ($upNextPrompt && !$playing && !$androidMpvActive) upNextPrompt.set(null)
  })

  onDestroy(clearTimer)
</script>

{#if $upNextPrompt}
  <div
    role="dialog"
    aria-modal="true"
    aria-label={m.up_next_title()}
    class="fixed inset-0 z-[85] flex items-end justify-center bg-black/55 p-4 sm:items-center"
  >
    <div class="w-full max-w-lg overflow-hidden rounded-2xl border border-white/15 bg-neutral-950 text-white shadow-2xl">
      {#if $upNextPrompt.artwork}
        <div class="relative aspect-[16/6] overflow-hidden">
          <img src={$upNextPrompt.artwork} alt="" class="h-full w-full object-cover" />
          <div class="absolute inset-0 bg-gradient-to-t from-neutral-950 to-black/10"></div>
        </div>
      {/if}
      <div class="p-5 sm:p-6">
        <p class="text-xs font-black uppercase tracking-[0.18em] text-theme">{m.up_next_title()}</p>
        <h2 class="mt-1 text-xl font-black">{$upNextPrompt.title}</h2>
        <p class="mt-1 text-sm text-white/60">{m.up_next_episode({ episode: $upNextPrompt.episode, seconds: remaining })}</p>
        <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button data-focusable onclick={$upNextPrompt.stay} class="h-11 rounded-xl px-4 text-sm font-bold text-white/70 hover:bg-white/10">
            <X size={17} class="mr-1.5 inline" />{m.up_next_stay()}
          </button>
          <button data-focusable onclick={$upNextPrompt.play} class="h-11 rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground">
            <Play size={17} class="mr-1.5 inline fill-current" />{m.up_next_play_now()}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
