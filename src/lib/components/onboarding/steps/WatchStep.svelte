<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import CircleHelp from '@lucide/svelte/icons/circle-help'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Eye from '@lucide/svelte/icons/eye'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import Film from '@lucide/svelte/icons/film'
  import History from '@lucide/svelte/icons/history'
  import LibraryBig from '@lucide/svelte/icons/library-big'
  import Play from '@lucide/svelte/icons/play'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { m } from '$lib/paraglide/messages.js'
  import type { OnboardingIntent, OnboardingMovieMetadata, OnboardingStartupLibrary } from '$lib/settings/onboarding'

  let {
    intent = $bindable(),
    movieMetadata = $bindable(),
    startupLibrary = $bindable(),
    tmdbToken = $bindable(),
    ratingsKey = $bindable(),
  }: {
    intent: OnboardingIntent
    movieMetadata: OnboardingMovieMetadata
    startupLibrary: OnboardingStartupLibrary
    tmdbToken: string
    ratingsKey: string
  } = $props()

  const tmdbSettingsUrl = 'https://www.themoviedb.org/settings/api'
  const omdbSettingsUrl = 'https://www.omdbapi.com/apikey.aspx'
  let showTmdbToken = $state(false)
  let showRatingsKey = $state(false)
  let externalError = $state('')

  const both = $derived(intent.anime && intent.films)
  const startupChoices = $derived([
    { id: 'movies', title: movieMetadata === 'tmdb' ? 'TMDB' : 'Stremio', body: m.onboarding_startup_movies_body(), Icon: Film },
    { id: 'auto', title: m.onboarding_automatic_anime(), body: m.onboarding_startup_anime_body(), Icon: Sparkles },
    { id: 'merged', title: m.onboarding_startup_merged(), body: m.onboarding_startup_merged_body(), Icon: LibraryBig },
    { id: 'adaptive', title: m.onboarding_startup_adaptive(), body: m.onboarding_startup_adaptive_body(), Icon: History },
  ])

  /** Refuse to untick the last one rather than allowing a state with no library and an error. */
  function toggle(key: 'anime' | 'films') {
    const next = { ...intent, [key]: !intent[key] }
    if (!next.anime && !next.films) return
    intent = next
  }

  async function openExternal(url: string) {
    externalError = ''
    try {
      await openUrl(url)
    } catch (cause) {
      externalError = cause instanceof Error ? cause.message : m.onboarding_external_error()
    }
  }
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_watch_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_watch_body()}</p>

<fieldset class="mt-7 space-y-3">
  <legend class="sr-only">{m.onboarding_watch_title()}</legend>
  {#each [{ key: 'anime' as const, title: m.onboarding_anime_title(), body: m.onboarding_automatic_body(), Icon: Sparkles }, { key: 'films' as const, title: m.onboarding_movies_title(), body: m.onboarding_movies_body(), Icon: Film }] as choice}
    <label class="setup-choice flex w-full cursor-pointer items-center gap-4 p-5 text-left {intent[choice.key] ? 'selected' : ''}">
      <input type="checkbox" data-focusable class="sr-only" checked={intent[choice.key]} onchange={() => toggle(choice.key)} />
      <choice.Icon size={24} class="shrink-0 text-muted-foreground" />
      <span class="min-w-0 flex-1"><span class="block text-lg font-semibold">{choice.title}</span><span class="mt-1 block text-sm leading-relaxed text-muted-foreground">{choice.body}</span></span>
      <span class="grid size-5 shrink-0 place-items-center rounded border border-foreground/40">{#if intent[choice.key]}<Check size={13} />{/if}</span>
    </label>
  {/each}
</fieldset>

{#if intent.films}
  <h2 class="mt-9 text-base font-semibold">{m.onboarding_metadata_title()}</h2>
  <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{m.onboarding_metadata_body()}</p>
  <div class="mt-4 grid gap-3 sm:grid-cols-2">
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
    <p class="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><CircleHelp size={16} class="shrink-0" />{m.onboarding_stremio_warning()}</p>
  {:else}
    <details class="mt-4 rounded-xl border border-border p-5">
      <summary class="cursor-pointer font-semibold">{m.onboarding_access_expand()}<span class="ml-3 text-xs font-normal text-muted-foreground">{tmdbToken.trim() ? m.onboarding_tmdb_token_saved() : m.onboarding_optional_now()}</span></summary>
      <div class="mt-5">
        <label for="setup-tmdb-token" class="text-sm font-semibold">{m.onboarding_tmdb_token_label()}</label>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{m.onboarding_access_draft()}</p>
        <div class="relative mt-3">
          <input id="setup-tmdb-token" data-focusable bind:value={tmdbToken} type={showTmdbToken ? 'text' : 'password'} autocomplete="off" spellcheck="false" class="setup-field pr-12 font-mono text-sm" placeholder="eyJhbGciOiJIUzI1NiJ9…" />
          <button type="button" data-focusable onclick={() => showTmdbToken = !showTmdbToken} aria-label={showTmdbToken ? m.onboarding_hide_key() : m.onboarding_show_key()} class="absolute right-1 top-1 grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-secondary">{#if showTmdbToken}<EyeOff size={17} />{:else}<Eye size={17} />{/if}</button>
        </div>
        <details class="mt-5 border-t border-border pt-4">
          <summary class="cursor-pointer text-sm">{m.onboarding_access_help()}</summary>
          <ol class="mt-4 list-decimal space-y-3 pl-5 text-xs leading-relaxed text-muted-foreground">
            {#each [m.onboarding_tmdb_instruction_1(), m.onboarding_tmdb_instruction_2(), m.onboarding_tmdb_instruction_3(), m.onboarding_tmdb_instruction_4()] as instruction}<li>{instruction}</li>{/each}
          </ol>
          <button type="button" data-focusable onclick={() => void openExternal(tmdbSettingsUrl)} class="setup-inline-button mt-4 bg-secondary"><ExternalLink size={15} />{m.onboarding_open_tmdb()}</button>
        </details>
        <details class="mt-4 border-t border-border pt-4">
          <summary class="cursor-pointer text-sm text-muted-foreground">{m.onboarding_ratings_expand()}</summary>
          <label for="setup-ratings-key" class="mt-4 block text-sm font-semibold">{m.onboarding_omdb_key_label()}</label>
          <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{m.onboarding_omdb_key_hint()}</p>
          <div class="relative mt-3">
            <input id="setup-ratings-key" data-focusable bind:value={ratingsKey} type={showRatingsKey ? 'text' : 'password'} autocomplete="off" spellcheck="false" class="setup-field pr-12 font-mono text-sm" />
            <button type="button" data-focusable onclick={() => showRatingsKey = !showRatingsKey} aria-label={showRatingsKey ? m.onboarding_hide_key() : m.onboarding_show_key()} class="absolute right-1 top-1 grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-secondary">{#if showRatingsKey}<EyeOff size={17} />{:else}<Eye size={17} />{/if}</button>
          </div>
          <button type="button" data-focusable onclick={() => void openExternal(omdbSettingsUrl)} class="setup-inline-button mt-3 bg-secondary"><ExternalLink size={15} />{m.onboarding_get_omdb()}</button>
        </details>
        <div class="mt-6 flex items-center gap-4"><img src="/brand/tmdb.svg" alt="TMDB" class="h-5 w-auto max-w-20 shrink-0" /><p class="text-xs leading-relaxed text-muted-foreground">{m.onboarding_tmdb_attribution()}</p></div>
      </div>
    </details>
  {/if}
  {#if externalError}<p class="mt-3 text-sm text-destructive" role="alert">{externalError}</p>{/if}
{/if}

{#if both}
  <h2 class="mt-9 text-base font-semibold">{m.onboarding_startup_title()}</h2>
  <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{m.onboarding_startup_body()}</p>
  <fieldset class="mt-4 grid gap-3 sm:grid-cols-2">
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
{/if}
