<script lang="ts">
  import CircleHelp from '@lucide/svelte/icons/circle-help'
  import Play from '@lucide/svelte/icons/play'
  import { m } from '$lib/paraglide/messages.js'
  import type { OnboardingMovieMetadata } from '$lib/settings/onboarding'

  let { movieMetadata = $bindable() }: { movieMetadata: OnboardingMovieMetadata } = $props()
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_metadata_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_metadata_body()}</p>

<div class="mt-7 grid gap-3 sm:grid-cols-2">
  <button type="button" data-focusable onclick={() => movieMetadata = 'tmdb'} aria-pressed={movieMetadata === 'tmdb'} class="setup-choice p-5 text-left {movieMetadata === 'tmdb' ? 'selected' : ''}">
    <span class="flex items-center justify-between gap-3"><img src="/brand/tmdb.svg" alt="TMDB" class="h-7 w-auto max-w-24" /><span class="text-xs text-muted-foreground">{m.onboarding_recommended()}</span></span>
    <span class="mt-6 block text-xl font-semibold">{m.onboarding_tmdb_title()}</span><span class="mt-2 block text-sm leading-relaxed text-muted-foreground">{m.onboarding_tmdb_body()}</span>
  </button>
  <button type="button" data-focusable onclick={() => movieMetadata = 'stremio'} aria-pressed={movieMetadata === 'stremio'} class="setup-choice p-5 text-left {movieMetadata === 'stremio' ? 'selected' : ''}">
    <Play size={27} class="text-muted-foreground" />
    <span class="mt-6 block text-xl font-semibold">{m.onboarding_stremio_title()}</span><span class="mt-2 block text-sm leading-relaxed text-muted-foreground">{m.onboarding_stremio_body()}</span>
  </button>
</div>

{#if movieMetadata === 'stremio'}
  <p class="mt-5 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"><CircleHelp size={17} class="mt-0.5 shrink-0" />{m.onboarding_stremio_warning()}</p>
{/if}
