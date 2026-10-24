<script lang="ts">
  import { tick } from 'svelte'
  import { goto } from '$app/navigation'
  import X from '@lucide/svelte/icons/x'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import { createCustomScreen } from '$lib/catalog/custom-screens'
  import { homeEditorOpen } from '$lib/catalog/home-editor'
  import { studioThemes } from '$lib/settings/theme-studio'
  import { screenThemeOptions, type ScreenThemeRef } from '$lib/themes/screen-theme'

  let { onclose }: { onclose: () => void } = $props()
  let name = $state('')
  let theme = $state('')
  let error = $state('')
  let input = $state<HTMLInputElement>()

  $effect(() => { void tick().then(() => input?.focus({ preventScroll: true })) })

  async function create(event: SubmitEvent) {
    event.preventDefault()
    try {
      createCustomScreen(name, (theme || null) as ScreenThemeRef | null)
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
      return
    }
    onclose()
    // The new screen opens empty but for its banner and Continue Watching: go straight to adding sections.
    await goto('/app/home')
    homeEditorOpen.set(true)
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />
<div class="fixed inset-0 z-[80] grid place-items-end bg-black/70 sm:place-items-center sm:p-4">
  <button type="button" tabindex="-1" class="absolute inset-0 cursor-default" onclick={onclose} aria-label="Close"></button>
  <div role="dialog" aria-modal="true" aria-labelledby="new-screen-title" data-nav-trap data-nav-escape
    class="relative w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:rounded-2xl">
    <form onsubmit={create} class="space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 id="new-screen-title" class="text-lg font-black">New screen</h2>
          <p class="mt-0.5 text-sm text-muted-foreground">Name it, then fill it with sections from any catalog using Edit Home.</p>
        </div>
        <button type="button" data-focusable onclick={onclose} aria-label="Close" class="grid size-9 shrink-0 place-items-center rounded-lg hover:bg-accent"><X size={18} /></button>
      </div>
      <label class="block space-y-1.5">
        <span class="text-sm font-bold">Name</span>
        <input bind:this={input} bind:value={name} data-focusable maxlength="32" placeholder="Movie night"
          class="h-11 w-full rounded-xl border border-border bg-input px-3 text-sm outline-none transition focus:border-theme/70" />
      </label>
      <div class="space-y-1.5">
        <span class="block text-sm font-bold">Theme</span>
        <SelectMenu bind:value={theme} options={screenThemeOptions($studioThemes)} ariaLabel="Theme for this screen" className="w-full" floating />
      </div>
      {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
      <div class="flex justify-end gap-2">
        <button type="button" data-focusable onclick={onclose} class="min-h-10 rounded-lg px-4 text-sm font-bold hover:bg-accent">Cancel</button>
        <button type="submit" data-focusable class="min-h-10 rounded-lg bg-primary px-4 text-sm font-black text-primary-foreground">Create screen</button>
      </div>
    </form>
  </div>
</div>
