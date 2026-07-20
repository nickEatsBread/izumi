<script lang="ts">
  import { goto } from '$app/navigation'
  import { tick } from 'svelte'
  import Search from 'lucide-svelte/icons/search'
  import X from 'lucide-svelte/icons/x'
  import ChevronRight from 'lucide-svelte/icons/chevron-right'
  import { isAndroid } from '$lib/platform'
  import * as h from '$lib/haptics'
  import { searchSettings, settingKey, type SettingSearchItem } from '$lib/settings/search'

  let { compact = false }: { compact?: boolean } = $props()
  let open = $state(false)
  let query = $state('')
  let input = $state<HTMLInputElement>()
  let trigger = $state<HTMLButtonElement>()
  let returnFocus: HTMLElement | null = null
  const results = $derived(searchSettings(query, $isAndroid).slice(0, 14))

  // The desktop launcher lives inside a sticky sidebar, which is its own stacking context. Move
  // the actual overlay to <body> so focused controls in the page can never paint over the dialog.
  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy: () => { if (node.parentNode === document.body) node.remove() } }
  }

  async function show() {
    h.tap()
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : (trigger ?? null)
    open = true
    await tick()
    input?.focus()
  }

  async function close() {
    open = false
    query = ''
    await tick()
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
    returnFocus = null
  }

  async function choose(item: SettingSearchItem) {
    h.tap()
    const search = item.anchored ? `?setting=${encodeURIComponent(settingKey(item.title))}` : ''
    await close()
    await goto(item.href + search)
  }
</script>

<svelte:window onkeydown={(e) => {
  if (open && e.key === 'Escape') { e.preventDefault(); close() }
  else if (!open && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    show()
  }
}} />

<button bind:this={trigger} type="button" data-focusable onclick={show} aria-label="Search settings"
  aria-haspopup="dialog" aria-expanded={open}
  class={compact
    ? 'grid size-10 shrink-0 place-items-center rounded-full transition-colors active:bg-accent hover:bg-secondary'
    : 'group flex h-10 w-full items-center gap-2 rounded-lg border border-border/80 bg-card px-3 text-sm font-semibold text-muted-foreground shadow-sm transition-colors hover:border-foreground/20 hover:bg-secondary/70 hover:text-foreground'}>
  <Search size={compact ? 21 : 17} />
  {#if !compact}
    <span class="min-w-0 flex-1 truncate text-left">Search</span>
    <kbd class="rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[0.6rem] font-bold text-muted-foreground group-hover:text-foreground">Ctrl K</kbd>
  {/if}
</button>

{#if open}
  <div use:portal data-nav-trap class="fixed inset-0 z-[100] isolate flex items-start justify-center px-3 pt-[max(4rem,env(safe-area-inset-top))] sm:pt-[12vh]">
    <button type="button" class="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close settings search" onclick={close}></button>
    <div role="dialog" aria-modal="true" aria-label="Search settings"
      class="relative z-10 flex max-h-[min(75vh,42rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <div class="flex items-center gap-2 border-b border-border px-3 transition-colors focus-within:border-theme/70">
        <Search size={20} class="shrink-0 text-muted-foreground" />
        <input bind:this={input} bind:value={query} data-focusable type="search"
          placeholder="Search settings…" aria-label="Search settings"
          style="box-shadow:none"
          class="min-w-0 flex-1 bg-transparent py-4 text-base outline-none placeholder:text-muted-foreground" />
        <button type="button" data-focusable onclick={close} aria-label="Close"
          class="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors active:bg-accent hover:bg-secondary">
          <X size={20} />
        </button>
      </div>

      <div class="min-h-0 overflow-y-auto bg-card p-2">
        {#if !query.trim()}
          <p class="px-3 py-8 text-center text-sm text-muted-foreground">Type a setting, feature, or keyword.</p>
        {:else if results.length}
          {#each results as item (item.category + item.title)}
            <button type="button" data-focusable onclick={() => choose(item)}
              class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-accent hover:bg-secondary">
              <span class="min-w-0 flex-1">
                <span class="block font-bold">{item.title}</span>
                <span class="block text-xs text-muted-foreground">{item.category}</span>
              </span>
              <ChevronRight size={18} class="shrink-0 text-muted-foreground" />
            </button>
          {/each}
        {:else}
          <p class="px-3 py-8 text-center text-sm text-muted-foreground">No settings found for “{query.trim()}”.</p>
        {/if}
      </div>
    </div>
  </div>
{/if}
