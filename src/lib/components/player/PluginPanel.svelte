<script lang="ts">
  import LoaderCircle from '@lucide/svelte/icons/loader-circle'
  import X from '@lucide/svelte/icons/x'
  import { openPluginPanel, pluginPanels, sendPluginEvent, type PluginRun } from '$lib/plugins/host'

  // A plugin's player panel (permission `player.panel`): a prompt, a status line and up to 20 results.
  // The plugin only ever sends this data; izumi draws it.
  let { run }: { run: PluginRun } = $props()
  let text = $state('')
  let input = $state<HTMLInputElement | undefined>()
  const panel = $derived($pluginPanels[run.id] ?? {})

  $effect(() => { input?.focus() })
  // Escape (and anything else that closes the player's menus) closes the panel too.
  $effect(() => {
    const close = () => openPluginPanel.set(null)
    window.addEventListener('player-menu-close', close)
    return () => window.removeEventListener('player-menu-close', close)
  })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const value = text.trim()
    if (value) sendPluginEvent(run.id, 'prompt', { text: value.slice(0, 500) })
  }
</script>

<div data-part="player.menu" data-variant="plugin" data-plugin={run.id}
     class="absolute bottom-full right-0 mb-2 w-[26rem] max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-sm text-white shadow-2xl"
     role="dialog" aria-label={run.panel?.label}>
  <form class="flex items-center gap-2 border-b border-white/10 p-2" onsubmit={submit}>
    <input bind:this={input} bind:value={text} data-focusable maxlength="500" placeholder={run.panel?.placeholder}
           class="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:bg-white/15"
           onkeydown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); openPluginPanel.set(null) } }} />
    <button type="button" data-focusable class="grid size-8 shrink-0 place-items-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
            onclick={() => openPluginPanel.set(null)} aria-label="Close"><X size={16} /></button>
  </form>
  {#if run.state === 'failed'}
    <p class="px-3 py-3 text-white/70">{run.name} stopped: {run.error}</p>
  {:else if panel.status || panel.busy}
    <p class="flex items-center gap-2 px-3 py-2.5 text-white/70" aria-live="polite">
      {#if panel.busy}<LoaderCircle size={14} class="shrink-0 animate-spin" />{/if}<span>{panel.status}</span>
    </p>
  {/if}
  {#if panel.items?.length}
    <ul class="max-h-72 overflow-y-auto p-1">
      {#each panel.items as item (item.id)}
        <li>
          <button type="button" data-focusable class="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-white/10"
                  onclick={() => sendPluginEvent(run.id, 'select', { id: item.id })}>
            <span class="font-medium">{item.label}</span>
            {#if item.detail}<span class="text-xs text-white/60">{item.detail}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="border-t border-white/10 px-3 py-1.5 text-[0.7rem] text-white/40">{run.name} · plugin</p>
</div>
