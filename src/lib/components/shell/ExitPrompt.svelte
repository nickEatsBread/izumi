<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { exitPrompt } from '$lib/player/session'

  // Game-mode Back-on-home confirm. `data-nav-trap` (see nav/index.ts) confines the
  // d-pad/stick to these two buttons; gamepad B cancels it (see nav/gamepad.ts).
  // The z-index has to clear the first-run wizard (z-160), which is the one screen that can ask for
  // this prompt while covering the whole viewport itself — underneath it, B looked like a dead
  // button. It stays below the launch ident (z-200), which owns the screen outright while it runs.
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
    class="fixed inset-0 z-[170] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
    onclick={cancel}
    onkeydown={(e) => e.key === 'Escape' && cancel()}
  >
    <div class="w-full max-w-lg rounded-3xl border border-border bg-card p-8 text-center shadow-2xl" role="presentation" onclick={(e) => e.stopPropagation()}>
      <h2 class="text-2xl font-black">Exit izumi?</h2>
      <p class="mt-2 text-base text-muted-foreground">You'll return to Steam.</p>
      <div class="mt-7 flex gap-4">
        <button bind:this={cancelBtn} data-focusable onclick={cancel}
                class="flex-1 rounded-xl bg-secondary px-5 py-3.5 text-base font-bold transition-colors hover:bg-accent">
          Cancel
        </button>
        <button data-focusable onclick={quit}
                class="flex-1 rounded-xl bg-destructive px-5 py-3.5 text-base font-bold text-destructive-foreground transition-colors hover:opacity-90">
          Exit
        </button>
      </div>
    </div>
  </div>
{/if}
