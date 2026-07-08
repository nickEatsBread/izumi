<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { exitPrompt } from '$lib/player/session'

  // Game-mode Back-on-home confirm. `data-nav-trap` (see nav/index.ts) confines the
  // d-pad/stick to these two buttons; gamepad B cancels it (see nav/gamepad.ts).
  let cancelBtn = $state<HTMLButtonElement>()
  // Default focus = Cancel (the safe choice) each time it opens.
  $effect(() => { if ($exitPrompt) cancelBtn?.focus() })

  const cancel = () => exitPrompt.set(false)
  const quit = () => { getCurrentWindow().close().catch(() => {}) }
</script>

{#if $exitPrompt}
  <div
    data-nav-trap
    role="presentation"
    class="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
    onclick={cancel}
    onkeydown={(e) => e.key === 'Escape' && cancel()}
  >
    <div class="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl" role="presentation" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-lg font-black">Exit izumi?</h2>
      <p class="mt-1 text-sm text-muted-foreground">You'll return to Steam.</p>
      <div class="mt-5 flex gap-3">
        <button bind:this={cancelBtn} data-focusable onclick={cancel}
                class="flex-1 rounded-lg bg-secondary px-4 py-2.5 text-sm font-bold transition-colors hover:bg-accent">
          Cancel
        </button>
        <button data-focusable onclick={quit}
                class="flex-1 rounded-lg bg-destructive px-4 py-2.5 text-sm font-bold text-destructive-foreground transition-colors hover:opacity-90">
          Exit
        </button>
      </div>
    </div>
  </div>
{/if}
