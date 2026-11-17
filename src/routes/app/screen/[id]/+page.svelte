<script lang="ts">
  // API 8 theme screens (`layout.screens`): a page of the active theme's own, its title over Home entries
  // (rows by role, blocks) drawn by Home itself on whatever catalog is open. Layout only; behaviour
  // belongs to plugins delivered in a pack.
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { derived, writable } from 'svelte/store'
  import Home from '../../home/+page.svelte'
  import { provideThemeScreen, themeScreens } from '$lib/themes/layout-state'

  const id = writable(page.params.id ?? '')
  $effect(() => id.set(page.params.id ?? ''))
  const screen = derived([themeScreens, id], ([screens, want]) => screens.find((entry) => entry.id === want) ?? null)
  provideThemeScreen(screen)
  // A screen the theme no longer offers (another theme, its layout switched off) returns to Home.
  $effect(() => { if (!$screen) void goto('/app/home', { replaceState: true }) })
</script>

{#if $screen}
  <div data-slot="screen" data-screen={$screen.id}>
    <h1 data-part="screen.title" class="px-4 pb-2 pt-5 text-2xl font-black sm:px-8 sm:pt-10 sm:text-3xl">{$screen.title}</h1>
    {#key $screen.id}<Home />{/key}
  </div>
{/if}
