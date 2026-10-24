<script lang="ts">
  import Pencil from '@lucide/svelte/icons/pencil'
  import Plus from '@lucide/svelte/icons/plus'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import SettingsRow from '$lib/components/settings/SettingsRow.svelte'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import CatalogPlatformLogo from './CatalogPlatformLogo.svelte'
  import NewScreenDialog from './NewScreenDialog.svelte'
  import { deleteCustomScreen, renameCustomScreen } from '$lib/catalog/custom-screens'
  import {
    CUSTOM_SCREEN_LIMIT, catalogLabel, catalogProviders, catalogScreens, customScreens, isCustomScreen,
    type CatalogScreen, type CustomScreenId,
  } from '$lib/settings/catalog'
  import { studioThemes } from '$lib/settings/theme-studio'
  import { screenThemeOptions, screenThemes, setScreenTheme, type ScreenThemeRef } from '$lib/themes/screen-theme'

  const screens = $derived(catalogScreens($catalogProviders, $customScreens))
  const options = $derived(screenThemeOptions($studioThemes))
  let creating = $state(false)
  let renaming = $state<CustomScreenId | null>(null)
  let draft = $state('')
  let confirmDelete = $state<CustomScreenId | null>(null)
  let error = $state('')

  // A removed design reads as Same as app, which is what that screen falls back to.
  const themeOf = (screen: CatalogScreen) => {
    const ref = $screenThemes[screen]
    return options.some((option) => option.value === ref) ? ref : ''
  }

  function startRename(screen: CustomScreenId) {
    renaming = screen
    draft = catalogLabel(screen, $customScreens)
    confirmDelete = null
    error = ''
  }

  function commitRename(event: SubmitEvent) {
    event.preventDefault()
    if (!renaming) return
    try {
      renameCustomScreen(renaming, draft)
      renaming = null
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
    }
  }

  function remove(screen: CustomScreenId) {
    if (confirmDelete !== screen) { confirmDelete = screen; return }
    deleteCustomScreen(screen)
    confirmDelete = null
  }
</script>

{#each screens as screen (screen)}
  {@const label = catalogLabel(screen, $customScreens)}
  <SettingsRow title={label} description={isCustomScreen(screen) ? 'Your own screen' : undefined} expanded={renaming === screen}>
    {#snippet leading()}<span class="block scale-90"><CatalogPlatformLogo platform={screen} /></span>{/snippet}
    {#snippet control()}
      <SelectMenu variant="inline" value={themeOf(screen)} {options} ariaLabel={`Theme for ${label}`}
        onChange={(value) => setScreenTheme(screen, (value || null) as ScreenThemeRef | null)} />
      {#if isCustomScreen(screen)}
        <button type="button" data-focusable onclick={() => startRename(screen)} aria-label={`Rename ${label}`} class="grid size-10 shrink-0 place-items-center rounded-lg hover:bg-accent"><Pencil size={16} /></button>
        <button type="button" data-focusable onclick={() => remove(screen)} aria-label={`Delete ${label}`}
          class="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-red-400 hover:bg-red-500/10">
          <Trash2 size={16} />{confirmDelete === screen ? 'Delete?' : ''}
        </button>
      {/if}
    {/snippet}
    {#if renaming === screen}
      <form class="flex gap-2" onsubmit={commitRename}>
        <input data-focusable bind:value={draft} maxlength="32" aria-label="Screen name" class="h-10 min-w-0 flex-1 rounded-lg border border-border bg-input px-3 text-sm" />
        <button type="submit" data-focusable class="rounded-lg bg-primary px-3 text-xs font-black text-primary-foreground">Save</button>
        <button type="button" data-focusable onclick={() => (renaming = null)} class="rounded-lg px-3 text-xs font-bold hover:bg-accent">Cancel</button>
      </form>
      {#if error}<p role="alert" class="mt-2 text-xs text-destructive">{error}</p>{/if}
    {/if}
  </SettingsRow>
{/each}
<SettingsRow settingKey="catalog-screens" title="New screen" description={`Name a screen of your own and fill it with sections from every catalog. Up to ${CUSTOM_SCREEN_LIMIT}.`}>
  {#snippet control()}
    <button type="button" data-focusable disabled={$customScreens.length >= CUSTOM_SCREEN_LIMIT} onclick={() => (creating = true)}
      class="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">
      <Plus size={16} /> New screen
    </button>
  {/snippet}
</SettingsRow>
{#if creating}<NewScreenDialog onclose={() => (creating = false)} />{/if}
