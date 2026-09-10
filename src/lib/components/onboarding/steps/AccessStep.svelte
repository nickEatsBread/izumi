<script lang="ts">
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Eye from '@lucide/svelte/icons/eye'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { m } from '$lib/paraglide/messages.js'

  let {
    tmdbToken = $bindable(),
    ratingsKey = $bindable(),
  }: { tmdbToken: string; ratingsKey: string } = $props()

  const tmdbSettingsUrl = 'https://www.themoviedb.org/settings/api'
  const omdbSettingsUrl = 'https://www.omdbapi.com/apikey.aspx'
  let showTmdbToken = $state(false)
  let showRatingsKey = $state(false)
  let externalError = $state('')

  async function openExternal(url: string) {
    externalError = ''
    try {
      await openUrl(url)
    } catch (cause) {
      externalError = cause instanceof Error ? cause.message : m.onboarding_external_error()
    }
  }
</script>

<h1 id="setup-title" data-step-heading tabindex="-1" aria-describedby="setup-progress" class="setup-heading">{m.onboarding_tmdb_access_title()}</h1>
<p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{m.onboarding_tmdb_access_body()}</p>

<div class="mt-7">
  <label for="setup-tmdb-token" class="text-sm font-semibold">{m.onboarding_tmdb_token_label()}</label>
  <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{m.onboarding_access_draft()}</p>
  <div class="relative mt-3">
    <input id="setup-tmdb-token" data-focusable bind:value={tmdbToken} type={showTmdbToken ? 'text' : 'password'} autocomplete="off" spellcheck="false" class="setup-field pr-12 font-mono text-sm" placeholder="eyJhbGciOiJIUzI1NiJ9…" />
    <button type="button" data-focusable onclick={() => showTmdbToken = !showTmdbToken} aria-label={showTmdbToken ? m.onboarding_hide_key() : m.onboarding_show_key()} class="absolute right-1 top-1 grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-secondary">{#if showTmdbToken}<EyeOff size={17} />{:else}<Eye size={17} />{/if}</button>
  </div>
  <button type="button" data-focusable onclick={() => void openExternal(tmdbSettingsUrl)} class="setup-inline-button mt-3 bg-secondary"><ExternalLink size={15} />{m.onboarding_open_tmdb()}</button>
</div>

<details class="mt-6 border-t border-border pt-5">
  <summary class="cursor-pointer text-sm font-semibold">{m.onboarding_access_help()}</summary>
  <ol class="mt-4 list-decimal space-y-3 pl-5 text-xs leading-relaxed text-muted-foreground">
    {#each [m.onboarding_tmdb_instruction_1(), m.onboarding_tmdb_instruction_2(), m.onboarding_tmdb_instruction_3(), m.onboarding_tmdb_instruction_4()] as instruction}<li>{instruction}</li>{/each}
  </ol>
</details>

<details class="mt-3 border-t border-border pt-5">
  <summary class="cursor-pointer text-sm text-muted-foreground">{m.onboarding_ratings_expand()}</summary>
  <label for="setup-ratings-key" class="mt-4 block text-sm font-semibold">{m.onboarding_omdb_key_label()}</label>
  <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{m.onboarding_omdb_key_hint()}</p>
  <div class="relative mt-3">
    <input id="setup-ratings-key" data-focusable bind:value={ratingsKey} type={showRatingsKey ? 'text' : 'password'} autocomplete="off" spellcheck="false" class="setup-field pr-12 font-mono text-sm" />
    <button type="button" data-focusable onclick={() => showRatingsKey = !showRatingsKey} aria-label={showRatingsKey ? m.onboarding_hide_key() : m.onboarding_show_key()} class="absolute right-1 top-1 grid size-10 place-items-center rounded-md text-muted-foreground hover:bg-secondary">{#if showRatingsKey}<EyeOff size={17} />{:else}<Eye size={17} />{/if}</button>
  </div>
  <button type="button" data-focusable onclick={() => void openExternal(omdbSettingsUrl)} class="setup-inline-button mt-3 bg-secondary"><ExternalLink size={15} />{m.onboarding_get_omdb()}</button>
</details>

<div class="mt-7 flex items-center gap-4"><img src="/brand/tmdb.svg" alt="TMDB" class="h-5 w-auto max-w-20 shrink-0" /><p class="text-xs leading-relaxed text-muted-foreground">{m.onboarding_tmdb_attribution()}</p></div>
{#if externalError}<p class="mt-3 text-sm text-destructive" role="alert">{externalError}</p>{/if}
