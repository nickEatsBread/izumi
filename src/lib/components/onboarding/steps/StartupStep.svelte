<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import Film from '@lucide/svelte/icons/film'
  import History from '@lucide/svelte/icons/history'
  import LibraryBig from '@lucide/svelte/icons/library-big'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import { m } from '$lib/paraglide/messages.js'
  import type { OnboardingMovieMetadata, OnboardingStartupLibrary } from '$lib/settings/onboarding'

  let {
    startupLibrary = $bindable(),
    movieMetadata,
  }: { startupLibrary: OnboardingStartupLibrary; movieMetadata: OnboardingMovieMetadata } = $props()

  const startupChoices = $derived([
    { id: 'movies', title: movieMetadata === 'tmdb' ? 'TMDB' : 'Stremio', body: m.onboarding_startup_movies_body(), Icon: Film },
    { id: 'auto', title: m.onboarding_automatic_anime(), body: m.onboarding_startup_anime_body(), Icon: Sparkles },
    { id: 'merged', title: m.onboarding_startup_merged(), body: m.onboarding_startup_merged_body(), Icon: LibraryBig },
    { id: 'adaptive', title: m.onboarding_startup_adaptive(), body: m.onboarding_startup_adaptive_body(), Icon: History },
  ])
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_startup_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_startup_body()}</p>

<fieldset class="mt-7 grid gap-3 sm:grid-cols-2">
  <legend class="sr-only">{m.onboarding_startup_title()}</legend>
  {#each startupChoices as choice}
    <label class="setup-choice flex cursor-pointer items-center gap-3 p-4 {startupLibrary === choice.id ? 'selected' : ''}">
      <input type="radio" name="startup-library" value={choice.id} bind:group={startupLibrary} data-focusable class="sr-only" />
      <choice.Icon size={22} class="shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1"><span class="block text-base font-semibold">{choice.title}</span><span class="mt-1 block text-sm leading-relaxed text-muted-foreground">{choice.body}</span></span>
      <span class="grid size-5 shrink-0 place-items-center rounded-full border border-foreground/40">{#if startupLibrary === choice.id}<Check size={13} />{/if}</span>
    </label>
  {/each}
</fieldset>
