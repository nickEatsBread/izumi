<script lang="ts">
  import { availableUpdate, updatePhase, updateProgress, updateBytes, updateError, updateDismissed, applyUpdate } from '$lib/updater'
  import { releaseHighlights } from '$lib/updater/notes'
  import { navLayer } from '$lib/nav/overlay'
  import { isTv } from '$lib/platform'
  import { playing } from '$lib/player/session'
  import { androidMpvActive } from '$lib/player/android-mpv'
  import { onboardingComplete } from '$lib/settings/onboarding'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import PackageOpen from '@lucide/svelte/icons/package-open'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'

  // Android's update prompt. The desktop corner toast was a thin strip over the phone tab bar and a
  // card too small to read on a TV, so Android gets a centred dialog. It is a nav layer: the d-pad
  // stays inside it, and B, remote Back and Escape mean "Later". It waits out playback and setup.
  const open = $derived(!!$availableUpdate && !$updateDismissed && $updatePhase !== 'idle'
    && !$playing && !$androidMpvActive && $onboardingComplete)
  // Three on a TV so the dialog fits a 960×540 viewport (a 1080p panel at 2x) without scrolling.
  const notes = $derived(releaseHighlights($availableUpdate?.notes ?? '', $isTv ? 3 : 5))
  const pct = $derived(Math.round($updateProgress * 100))
  // No Content-Length → no honest percentage; show the byte count and a sliding bar instead.
  const known = $derived($updateProgress > 0)
  const mb = $derived(($updateBytes / 1_048_576).toFixed(1))
  const later = () => updateDismissed.set(true)

  // navLayer focuses the first button when the dialog opens. A phase change swaps the buttons out
  // from under the focus, so put it back on the new first button.
  let card = $state<HTMLElement>()
  let shownPhase = ''
  $effect(() => {
    const phase = $updatePhase
    if (shownPhase && phase !== shownPhase) {
      // Hide only hid the download; how it ended needs the user again.
      if (phase === 'ready' || phase === 'error') updateDismissed.set(false)
      card?.querySelector<HTMLElement>('[data-focusable]')?.focus()
    }
    shownPhase = phase
  })

  const text = $derived($isTv ? 'text-lg' : 'text-base')
  const iconSize = $derived($isTv ? 30 : 26)
  const btn = $derived(`rounded-xl font-bold transition-opacity hover:opacity-90 ${$isTv ? 'px-8 py-3.5 text-lg' : 'w-full py-3.5 text-base'}`)
</script>

<!-- Each phase's icon is new markup, so its entrance plays once when that phase appears; only the
     download arrow loops. The app-wide reduced-motion rules stop all of them. -->
{#snippet title(label: string, icon: 'available' | 'downloading' | 'ready' | 'error')}
  <div class="flex items-center gap-4">
    <span aria-hidden="true" class="grid shrink-0 place-items-center rounded-2xl {$isTv ? 'size-14' : 'size-12'}
      {icon === 'error' ? 'bg-red-500/15 text-red-400' : 'bg-theme/15 text-theme'}">
      {#if icon === 'downloading'}
        <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <g class="fall"><path d="M12 15V3" /><path d="m7 10 5 5 5-5" /></g>
        </svg>
      {:else if icon === 'error'}
        <span class="shake grid"><TriangleAlert size={iconSize} /></span>
      {:else if icon === 'ready'}
        <span class="drop grid"><PackageOpen size={iconSize} /></span>
      {:else}
        <span class="pop grid"><Sparkles size={iconSize} /></span>
      {/if}
    </span>
    <h2 id="update-dialog-title" class="font-black {$isTv ? 'text-2xl' : 'text-xl'}">{label}</h2>
  </div>
{/snippet}

{#snippet buttons(primary: [string, () => void] | null, secondary: string)}
  <div class="flex {$isTv ? 'mt-6 gap-4' : 'mt-6 flex-col gap-3'}">
    {#if primary}
      <button type="button" data-focusable onclick={primary[1]} class="{btn} bg-primary text-primary-foreground">{primary[0]}</button>
    {/if}
    <button type="button" data-focusable onclick={later} class="{btn} bg-secondary">{secondary}</button>
  </div>
{/snippet}

{#if open && $availableUpdate}
  <div role="presentation" class="fixed inset-0 z-[150] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
       onclick={(e) => { if (e.target === e.currentTarget) later() }}>
    <div bind:this={card} role="alertdialog" aria-modal="true" aria-labelledby="update-dialog-title" data-theme-protected
         use:navLayer={{ kind: 'update', onClose: later, initialFocus: 'always' }}
         class="max-h-full w-full overflow-y-auto rounded-3xl border border-border bg-card shadow-2xl {$isTv ? 'max-w-2xl p-8' : 'max-w-md p-6'}">
      {#if $updatePhase === 'available'}
        {@render title('Update available', 'available')}
        <p class="mt-3 text-muted-foreground {text}">izumi {$availableUpdate.version} is ready to install.</p>
        {#if notes.items.length}
          <ul class="mt-4 list-disc space-y-1.5 pl-5 {text}">
            {#each notes.items as item}<li>{item}</li>{/each}
          </ul>
          {#if notes.more}<p class="mt-2 text-muted-foreground {$isTv ? 'text-base' : 'text-sm'}">+{notes.more} more</p>{/if}
        {/if}
        {@render buttons(['Update now', applyUpdate], 'Later')}
      {:else if $updatePhase === 'downloading'}
        {@render title('Downloading update', 'downloading')}
        <p class="mt-3 text-muted-foreground {text}">
          izumi {$availableUpdate.version}{known ? ` · ${pct}%` : $updateBytes > 0 ? ` · ${mb} MB` : ''}
        </p>
        <div class="mt-5 w-full overflow-hidden rounded-full bg-background {$isTv ? 'h-3' : 'h-2'}"
             role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? pct : undefined}>
          {#if known}
            <div class="h-full bg-primary transition-[width]" style="width:{pct}%"></div>
          {:else}
            <div class="indeterminate h-full w-1/3 bg-primary"></div>
          {/if}
        </div>
        <p class="mt-3 text-muted-foreground {$isTv ? 'text-base' : 'text-sm'}">When it finishes, Android installs the update and izumi closes.</p>
        {@render buttons(null, 'Hide')}
      {:else if $updatePhase === 'ready'}
        {@render title('Finish in the installer', 'ready')}
        <p class="mt-3 text-muted-foreground {text}">Confirm the update in Android's installer. If you closed it, open it again.</p>
        {@render buttons(['Open installer', applyUpdate], 'Later')}
      {:else if $updatePhase === 'error'}
        {@render title('Update failed', 'error')}
        <p class="mt-3 break-words {text}">{$updateError}</p>
        {@render buttons(['Try again', applyUpdate], 'Close')}
      {/if}
    </div>
  </div>
{/if}

<style>
  .pop { animation: update-pop 650ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  .drop { animation: update-drop 600ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  .shake { animation: update-shake 500ms ease-in-out both; }
  .fall { animation: update-fall 1.4s ease-in-out infinite; }
  @keyframes update-pop { from { opacity: 0; transform: scale(0.3) rotate(-30deg); } to { opacity: 1; transform: none; } }
  @keyframes update-drop { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: none; } }
  @keyframes update-shake {
    0%, 100% { transform: none; }
    20% { transform: translateX(-4px) rotate(-6deg); }
    40% { transform: translateX(4px) rotate(6deg); }
    60% { transform: translateX(-3px) rotate(-3deg); }
    80% { transform: translateX(2px); }
  }
  /* The arrow falls into the tray, fading out at the bottom and back in at the top. */
  @keyframes update-fall {
    0% { opacity: 0; transform: translateY(-7px); }
    30% { opacity: 1; }
    70% { opacity: 1; transform: none; }
    100% { opacity: 0; transform: translateY(4px); }
  }
</style>
